import { mapDocxText } from './redaction-docx-map'
import { prepareDocxForBurn } from './redaction-docx-xml'
import { loadOoxmlZipEntries, type OoxmlPackageLimits } from '@obiter/ooxml'
import {
  decodeXmlText,
  extractWordXmlText,
  normaliseFileType,
  readDocxNoteBodies,
} from './document-extraction'

const UNEXAMINED_PART_MIN_CHARS = 20

const FUSED_TOKEN_MIN_LENGTH = 30
const FUSED_TOKEN_CHAR_SHARE = 0.05
const FUSED_TOKEN_ABSOLUTE_LENGTH = 100
const FUSED_LETTER_RUN_MIN_LENGTH = 16
const FUSED_LETTER_RUN_SHARE = 0.1
const FUSED_LETTER_RUN_MIN_TOTAL_LETTERS = 50

function nonWhitespaceChars(value: string) {
  return [...value].filter((ch) => !/\s/u.test(ch)).length
}

function regionLabel(name: string, chars: number) {
  return `${name} (${chars} chars not examined)`
}

function uncoveredNoteChars(
  entries: Map<string, Uint8Array>,
  extractedText: string,
  kind: 'footnote' | 'endnote',
): number {
  let chars = 0
  for (const note of readDocxNoteBodies(entries)) {
    if (note.kind !== kind) continue
    if (!extractedText.includes(note.text))
      chars += nonWhitespaceChars(note.text)
  }
  return chars
}

function wordPartText(entries: Map<string, Uint8Array>, name: string) {
  const payload = entries.get(name)
  if (!payload) return ''
  return extractWordXmlText(new TextDecoder().decode(payload))
}

function decodePart(entries: Map<string, Uint8Array>, name: string) {
  const payload = entries.get(name)
  if (!payload) return null
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch {
    return null
  }
}

function unexaminedChars(text: string, extractedText: string) {
  if (!text || nonWhitespaceChars(text) === 0) return 0
  if (extractedText.includes(text)) return 0
  return nonWhitespaceChars(text)
}

function partProseText(xml: string) {
  const extra: string[] = []
  for (const tag of ['delText', 'a:t', 'm:t', 'instrText'] as const) {
    const pattern = new RegExp(
      `<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`,
      'gi',
    )
    for (const match of xml.matchAll(pattern))
      extra.push(decodeXmlText(match[1] ?? ''))
  }
  return [extractWordXmlText(xml), ...extra]
    .filter((part) => part !== '')
    .join('')
}

function trackedRevisionBlocks(xml: string) {
  const blocks: string[] = []
  let remainder = xml
  for (const tag of ['del', 'moveFrom'] as const) {
    const pattern = new RegExp(
      `<w:${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</w:${tag}>`,
      'gi',
    )
    remainder = remainder.replace(pattern, (_match, inner: string) => {
      blocks.push(partProseText(inner ?? ''))
      return ''
    })
  }
  for (const match of remainder.matchAll(
    /<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>/gi,
  )) {
    blocks.push(decodeXmlText(match[1] ?? ''))
  }
  return blocks.filter((block) => nonWhitespaceChars(block) > 0)
}

function bodyDrawingText(documentXml: string) {
  const parts: string[] = []
  for (const match of documentXml.matchAll(
    /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gi,
  )) {
    parts.push(decodeXmlText(match[1] ?? ''))
  }
  return parts.join('')
}

const CDATA_OPEN = '<![CDATA['
const CDATA_CLOSE = ']]>'

function elementCharData(xml: string) {
  const parts: string[] = []
  const pushText = (text: string) => {
    if (text !== '') parts.push(decodeXmlText(text))
  }
  let cursor = 0
  while (cursor < xml.length) {
    const lt = xml.indexOf('<', cursor)
    if (lt === -1) {
      pushText(xml.slice(cursor))
      break
    }
    pushText(xml.slice(cursor, lt))
    if (xml.startsWith(CDATA_OPEN, lt)) {
      const body = lt + CDATA_OPEN.length
      const end = xml.indexOf(CDATA_CLOSE, body)
      if (end === -1) {
        parts.push(xml.slice(body))
        break
      }
      parts.push(xml.slice(body, end))
      cursor = end + CDATA_CLOSE.length
      continue
    }
    const gt = xml.indexOf('>', lt)
    if (gt === -1) {
      pushText(xml.slice(lt))
      break
    }
    cursor = gt + 1
  }
  return parts.join('')
}

function docPropsScalarValues(xml: string) {
  const values = new Map<string, string>()
  const pattern =
    /<(?:\w+:)?(title|subject|keywords|description|category|creator|lastModifiedBy)(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?\1>/gi
  for (const match of xml.matchAll(pattern)) {
    const name = (match[1] ?? '').toLowerCase()
    const prior = values.get(name) ?? ''
    values.set(name, prior + decodeXmlText(match[2] ?? ''))
  }
  return values
}

function customStringValues(xml: string) {
  const parts: string[] = []
  for (const match of xml.matchAll(
    /<vt:(?:lpstr|lpsz|bstr|lpwstr)(?:\s[^>]*)?>([\s\S]*?)<\/vt:(?:lpstr|lpsz|bstr|lpwstr)>/gi,
  )) {
    parts.push(decodeXmlText(match[1] ?? ''))
  }
  return parts.join('')
}

type AltChunkRef = { partName: string; missing: boolean }

function altChunkRefs(
  entries: Map<string, Uint8Array>,
  storyXml: Map<string, string>,
): AltChunkRef[] {
  const refs = new Map<string, AltChunkRef>()
  const normalise = (base: string, target: string) => {
    const raw = target.startsWith('/') ? target.slice(1) : base + target
    const out: string[] = []
    for (const part of raw.replace(/\\/g, '/').split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') out.pop()
      else out.push(part)
    }
    return out.join('/')
  }
  const baseDir = (relsName: string) =>
    relsName === '_rels/.rels'
      ? ''
      : `${relsName.slice(0, Math.max(0, relsName.lastIndexOf('/_rels/')))}/`
  const relsByFile = new Map<
    string,
    Array<{ id: string; type: string; target: string }>
  >()
  for (const [name] of entries) {
    if (!name.toLowerCase().endsWith('.rels')) continue
    const xml = decodePart(entries, name)
    if (!xml) continue
    const list: Array<{ id: string; type: string; target: string }> = []
    for (const match of xml.matchAll(/<Relationship\b[^>]*>/gi)) {
      const tag = match[0]
      if (/TargetMode\s*=\s*"External"/i.test(tag)) continue
      const id = /Id\s*=\s*"([^"]+)"/i.exec(tag)?.[1]
      const target = /Target\s*=\s*"([^"]+)"/i.exec(tag)?.[1]
      const type = /Type\s*=\s*"([^"]+)"/i.exec(tag)?.[1] ?? ''
      if (id && target) list.push({ id, type, target })
    }
    relsByFile.set(name, list)
  }
  const addTarget = (relsName: string, target: string) => {
    if (/^(https?|mailto|ftp):/i.test(target)) return
    const resolved = normalise(baseDir(relsName), target)
    if (!refs.has(resolved))
      refs.set(resolved, {
        partName: resolved,
        missing: !entries.has(resolved),
      })
  }
  for (const [relsName, rels] of relsByFile) {
    for (const rel of rels) {
      if (rel.type.toLowerCase().endsWith('/afchunk'))
        addTarget(relsName, rel.target)
    }
  }
  for (const [partName, xml] of storyXml) {
    const relsName = partName.includes('/')
      ? `${partName.slice(0, partName.lastIndexOf('/'))}/_rels/${partName.slice(partName.lastIndexOf('/') + 1)}.rels`
      : '_rels/.rels'
    const rels = relsByFile.get(relsName) ?? []
    for (const match of xml.matchAll(/<w:altChunk\b[^>]*>/gi)) {
      const id = /r:id\s*=\s*"([^"]+)"/i.exec(match[0])?.[1]
      const target = rels.find((rel) => rel.id === id)?.target
      if (id && target) addTarget(relsName, target)
    }
  }
  for (const [name] of entries) {
    const lower = name.toLowerCase()
    if (
      /^word\//i.test(name) &&
      (/\.(html?|mht|mhtml)$/i.test(lower) || lower.includes('afchunk')) &&
      !refs.has(name)
    ) {
      refs.set(name, { partName: name, missing: false })
    }
  }
  return [...refs.values()]
}

export function countBodyTextboxChars(documentXml: string) {
  let chars = 0
  const blocks = /<w:txbxContent[\s\S]*?<\/w:txbxContent>/gi
  for (const block of documentXml.matchAll(blocks))
    chars += nonWhitespaceChars(extractWordXmlText(block[0]))
  return chars
}

export async function findUncoveredDocxRegions(
  sourceBytes: Buffer,
  extractedText = '',
  limits?: OoxmlPackageLimits,
): Promise<string[]> {
  let entries: Map<string, Uint8Array>
  try {
    entries = await loadOoxmlZipEntries(sourceBytes, limits)
  } catch {
    return []
  }
  const regions = docxRegions(entries, extractedText, false)
  if (regions.length === 0) return regions
  let walkerCoordinates = false
  try {
    walkerCoordinates =
      mapDocxText(
        await loadOoxmlZipEntries(
          await prepareDocxForBurn(sourceBytes, limits),
          limits,
        ),
      ).text === extractedText.trim()
  } catch {
    // Not walker coordinates; the burn refuses these runs on its own.
  }
  return walkerCoordinates ? docxRegions(entries, extractedText, true) : regions
}

function docxRegions(
  entries: Map<string, Uint8Array>,
  extractedText: string,
  mappedCoverage: boolean,
): string[] {
  const regions: string[] = []
  const pushChars = (name: string, chars: number) => {
    if (chars >= UNEXAMINED_PART_MIN_CHARS)
      regions.push(regionLabel(name, chars))
  }

  const storyXml = new Map<string, string>()
  for (const [name] of entries) {
    if (
      /^word\/(document\.xml|header[^/]*\.xml|footer[^/]*\.xml|footnotes\.xml|endnotes\.xml)$/i.test(
        name,
      )
    ) {
      const xml = decodePart(entries, name)
      if (xml) storyXml.set(name, xml)
    }
  }

  const uncoveredFootnoteChars = uncoveredNoteChars(
    entries,
    extractedText,
    'footnote',
  )
  if (!mappedCoverage && uncoveredFootnoteChars >= UNEXAMINED_PART_MIN_CHARS)
    regions.push(regionLabel('footnotes', uncoveredFootnoteChars))
  const uncoveredEndnoteChars = uncoveredNoteChars(
    entries,
    extractedText,
    'endnote',
  )
  if (!mappedCoverage && uncoveredEndnoteChars >= UNEXAMINED_PART_MIN_CHARS)
    regions.push(regionLabel('endnotes', uncoveredEndnoteChars))

  for (const [name, xml] of storyXml) {
    if (mappedCoverage || !/^word\/(header|footer)/i.test(name)) continue
    pushChars(name, unexaminedChars(extractWordXmlText(xml), extractedText))
  }

  for (const [name, xml] of storyXml) {
    let chars = 0
    for (const block of trackedRevisionBlocks(xml))
      chars += unexaminedChars(block, extractedText)
    if (chars > 0 && !mappedCoverage)
      regions.push(`tracked changes in ${name} (${chars} chars not examined)`)
  }

  for (const [name] of entries) {
    const lower = name.toLowerCase()
    const label = /^word\/comments.*\.xml$/i.test(lower)
      ? 'comments'
      : /^word\/people.*\.xml$/i.test(lower)
        ? 'comment authors'
        : null
    if (!label) continue
    if (!mappedCoverage || label !== 'comments')
      pushChars(label, nonWhitespaceChars(wordPartText(entries, name)))
  }

  const documentXml = storyXml.get('word/document.xml')
  if (documentXml) {
    if (!mappedCoverage)
      pushChars('textboxes', countBodyTextboxChars(documentXml))
    pushChars(
      'drawing textboxes',
      unexaminedChars(bodyDrawingText(documentXml), extractedText),
    )
  }

  const altChunkParts = new Set<string>()
  for (const ref of altChunkRefs(entries, storyXml)) {
    if (ref.missing) {
      regions.push(`altChunk target ${ref.partName} referenced but missing`)
      continue
    }
    altChunkParts.add(ref.partName)
    const payload = entries.get(ref.partName)
    if (!payload || payload.byteLength === 0) continue
    const xml = decodePart(entries, ref.partName)
    const chars = xml
      ? nonWhitespaceChars(elementCharData(xml))
      : payload.byteLength
    if (chars > 0)
      regions.push(
        `altChunk content in ${ref.partName} (${chars} chars not examined)`,
      )
  }

  const coreXml = decodePart(entries, 'docProps/core.xml')
  if (coreXml) {
    for (const [scalar, value] of docPropsScalarValues(coreXml)) {
      pushChars(`docProps ${scalar}`, unexaminedChars(value, extractedText))
    }
  }
  const appXml = decodePart(entries, 'docProps/app.xml')
  if (appXml) {
    pushChars(
      'docProps titles',
      unexaminedChars(customStringValues(appXml), extractedText),
    )
  }
  const customXml = decodePart(entries, 'docProps/custom.xml')
  if (customXml) {
    pushChars(
      'docProps custom',
      unexaminedChars(elementCharData(customXml), extractedText),
    )
  }

  for (const [name] of entries) {
    const lower = name.toLowerCase()
    if (/^customxml\/item\d+\.xml$/i.test(lower)) {
      const xml = decodePart(entries, name)
      if (xml)
        pushChars(
          `customXml content in ${name}`,
          unexaminedChars(elementCharData(xml), extractedText),
        )
    }
  }

  for (const [name] of entries) {
    if (
      !/^word\/(styles.*\.xml|numbering.*\.xml|fontTable\.xml)$/i.test(name) &&
      !/^word\/theme\//i.test(name) &&
      !/^word\/(settings|webSettings)\.xml$/i.test(name)
    ) {
      continue
    }
    const xml = decodePart(entries, name)
    if (xml) pushChars(name, unexaminedChars(partProseText(xml), extractedText))
  }

  for (const [name, payload] of entries) {
    const lower = name.toLowerCase()
    if (
      lower === '[content_types].xml' ||
      lower.endsWith('.rels') ||
      /^docprops\/thumbnail\./i.test(lower) ||
      storyXml.has(name) ||
      altChunkParts.has(name) ||
      /^word\/(comments.*|people.*)\.xml$/i.test(lower) ||
      lower === 'docprops/core.xml' ||
      lower === 'docprops/app.xml' ||
      lower === 'docprops/custom.xml' ||
      /^customxml\/item\d+\.xml$/i.test(lower) ||
      /^word\/(styles.*\.xml|numbering.*\.xml|fontTable\.xml)$/i.test(name) ||
      /^word\/theme\//i.test(name) ||
      /^word\/(settings|webSettings)\.xml$/i.test(name)
    ) {
      continue
    }
    if (
      /^word\/media\//i.test(name) &&
      /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg|ico|webp)$/i.test(lower)
    ) {
      continue
    }
    if (lower.endsWith('.xml')) {
      const xml = decodePart(entries, name)
      if (xml) {
        pushChars(
          `unexamined part ${name}`,
          unexaminedChars(elementCharData(xml), extractedText),
        )
      } else if (payload.byteLength > 0) {
        regions.push(
          `unexamined part ${name} (${payload.byteLength} bytes never examined)`,
        )
      }
    } else if (payload.byteLength > 0) {
      regions.push(
        `unexamined part ${name} (${payload.byteLength} bytes never examined)`,
      )
    }
  }
  return regions
}

export function findUncoveredPdfRegions(extractedText: string): string[] {
  const tokens = extractedText.split(/\s+/u).filter((token) => token !== '')
  let total = 0
  let longChars = 0
  let longest = 0
  for (const token of tokens) {
    const length = [...token].length
    total += length
    if (length > longest) longest = length
    if (length > FUSED_TOKEN_MIN_LENGTH) longChars += length
  }
  if (total === 0) return []
  if (
    longChars / total >= FUSED_TOKEN_CHAR_SHARE ||
    longest >= FUSED_TOKEN_ABSOLUTE_LENGTH
  ) {
    const share = Math.round((longChars / total) * 100)
    return [
      `fused-text (longest whitespace-free token ${longest} chars; ${share}% of chars in tokens over ${FUSED_TOKEN_MIN_LENGTH} chars)`,
    ]
  }
  const runs = extractedText.match(/[A-Za-z]+/gu) ?? []
  let totalLetters = 0
  let longestRun = 0
  let longRunChars = 0
  for (const run of runs) {
    const length = [...run].length
    totalLetters += length
    if (length > longestRun) longestRun = length
    if (length >= FUSED_LETTER_RUN_MIN_LENGTH) longRunChars += length
  }
  if (
    totalLetters >= FUSED_LETTER_RUN_MIN_TOTAL_LETTERS &&
    longRunChars / totalLetters >= FUSED_LETTER_RUN_SHARE
  ) {
    const share = Math.round((longRunChars / totalLetters) * 100)
    return [
      `fused-text (longest letter run ${longestRun} chars; ${share}% of letters in runs of ${FUSED_LETTER_RUN_MIN_LENGTH}+ chars)`,
    ]
  }
  return []
}

function classifySource(
  filename: string,
  mimeType: string | null,
): 'docx' | 'pdf' | null {
  const fromMime = mimeType ? normaliseFileType(mimeType) : null
  if (fromMime === 'docx' || fromMime === 'pdf') return fromMime
  const lower = filename.toLowerCase()
  if (lower.endsWith('.docx')) return 'docx'
  if (lower.endsWith('.pdf')) return 'pdf'
  return null
}

export async function findUncoveredRegions(input: {
  filename: string
  mimeType: string | null
  sourceBytes: Buffer | null
  extractedText: string
  ooxmlLimits?: OoxmlPackageLimits
}): Promise<string[]> {
  const kind = classifySource(input.filename, input.mimeType)
  if (kind === 'pdf') return findUncoveredPdfRegions(input.extractedText)
  if (kind !== 'docx' || !input.sourceBytes) return []
  return findUncoveredDocxRegions(
    input.sourceBytes,
    input.extractedText,
    input.ooxmlLimits,
  )
}
