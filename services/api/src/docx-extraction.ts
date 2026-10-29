import {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  loadOoxmlZipEntries,
  type OoxmlPackageLimits,
} from '@obiter/ooxml'
import { posix } from 'node:path'

export function decodeXmlText(value: string) {
  return value.replace(
    /&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity, code: string) => {
      interface XmlNamedEntities {
        [code: string]: string
      }
      const named: XmlNamedEntities = {
        lt: '<',
        gt: '>',
        amp: '&',
        quot: '"',
        apos: "'",
      }
      const namedValue = named[code.toLowerCase()]
      if (namedValue) return namedValue
      const numeric = code.toLowerCase().startsWith('#x')
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity
    },
  )
}

export function extractWordXmlText(xml: string) {
  const parts: string[] = []
  const tokens =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)(?:\s[^>]*)?\s*\/\s*>|<\/w:p>/gi
  for (const match of xml.matchAll(tokens)) {
    if (match[1] !== undefined) parts.push(decodeXmlText(match[1]))
    else if (match[0].toLowerCase() === '</w:p>') parts.push('\n')
    else if (match[0].toLowerCase().startsWith('<w:tab')) parts.push('\t')
    else parts.push('\n')
  }
  return parts.join('').trim()
}

function xmlAttribute(tag: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}="([^"]+)"`, 'i').exec(tag)?.[1]
}

function hasDocxVisualContent(xml: string, relationshipsXml: string) {
  return (
    /<w:drawing\b|<pic:pic\b/i.test(xml) ||
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*>/gi)].some((match) =>
      /\/image$/i.test(xmlAttribute(match[0], 'Type') ?? ''),
    )
  )
}

interface DocxSupplementalContent {
  header: string[]
  footer: string[]
  /** Labelled footnote/endnote bodies, appended after the footer. */
  notes: string[]
  visualContent: 'present' | 'absent' | 'unknown'
}

export interface DocxNoteBody {
  kind: 'footnote' | 'endnote'
  id: string
  text: string
}

/**
 * Footnote/endnote bodies in document order, skipping separator and
 * continuation placeholders (w:type). Shared by extraction and the coverage
 * guard so both agree on what "covered" means.
 */
export function readDocxNoteBodies(
  entries: Map<string, Uint8Array>,
): DocxNoteBody[] {
  const notes: DocxNoteBody[] = []
  for (const [entryName, payload] of entries) {
    const lower = entryName.toLowerCase()
    const kind =
      lower === 'word/footnotes.xml'
        ? ('footnote' as const)
        : lower === 'word/endnotes.xml'
          ? ('endnote' as const)
          : null
    if (!kind) continue
    const tag = kind === 'footnote' ? 'footnote' : 'endnote'
    // (?<!\/)> keeps self-closing placeholders (<w:footnote ... />) from
    // matching as an open tag and swallowing the next note's body.
    const pattern = new RegExp(
      `<w:${tag}\\b([^>]*)(?<!\\/)>([\\s\\S]*?)<\\/w:${tag}>`,
      'gi',
    )
    const xml = new TextDecoder().decode(payload)
    for (const match of xml.matchAll(pattern)) {
      // Any w:type means a non-content placeholder (separator,
      // continuationSeparator, continuationNotice).
      if (/\bw:type\s*=/i.test(match[1] ?? '')) continue
      const id = /\bw:id\s*=\s*"([^"]+)"/i.exec(match[1] ?? '')?.[1] ?? '?'
      const text = extractWordXmlText(match[2] ?? '')
      if (text) notes.push({ kind, id, text })
    }
  }
  return notes
}

/**
 * Addressable label for a note body: the w:id routes a future OOXML burn-in
 * back to word/footnotes.xml (or endnotes.xml); the body keeps the w:anchor
 * context ("Footnote reference N") next to its w:footnoteReference in the
 * main text, so reviewers can find the reference point.
 */
export function formatDocxNoteBody(note: DocxNoteBody): string {
  const label = note.kind === 'footnote' ? 'Footnote' : 'Endnote'
  return `[${label} ${note.id}] ${note.text}`
}

export interface DocumentExtractionDependencies {
  extractDocxSupplementalContent?: (
    buffer: Buffer,
    limits?: OoxmlPackageLimits,
  ) => Promise<DocxSupplementalContent>
  ooxmlLimits?: OoxmlPackageLimits
}

export async function boundedDocxBuffer(
  buffer: Buffer,
  limits: OoxmlPackageLimits,
): Promise<Buffer> {
  await loadOoxmlZipEntries(buffer, limits)
  return buffer
}

export async function extractDocxSupplementalContent(
  buffer: Buffer,
  limits: OoxmlPackageLimits = DEFAULT_OOXML_PACKAGE_LIMITS,
): Promise<DocxSupplementalContent> {
  const payloads = await loadOoxmlZipEntries(buffer, limits)
  const documentPayload = payloads.get('word/document.xml')
  const relationshipsPayload = payloads.get('word/_rels/document.xml.rels')
  if (!documentPayload)
    return { header: [], footer: [], notes: [], visualContent: 'unknown' }

  const documentXml = new TextDecoder().decode(documentPayload)
  const relationshipsXml = relationshipsPayload
    ? new TextDecoder().decode(relationshipsPayload)
    : ''
  let visualContent: DocxSupplementalContent['visualContent'] =
    hasDocxVisualContent(documentXml, relationshipsXml) ? 'present' : 'absent'
  const referencedIds = new Set(
    [...documentXml.matchAll(/<w:(?:header|footer)Reference\b[^>]*>/gi)]
      .map((match) => xmlAttribute(match[0], 'r:id'))
      .filter((id): id is string => id !== undefined),
  )
  const referencedParts = [
    ...relationshipsXml.matchAll(/<Relationship\b[^>]*>/gi),
  ]
    .flatMap((match) => {
      const id = xmlAttribute(match[0], 'Id')
      const target = xmlAttribute(match[0], 'Target')
      if (!id || !target || !referencedIds.has(id)) return []
      const name = target.startsWith('/')
        ? target.slice(1)
        : posix.normalize(posix.join('word', decodeXmlText(target)))
      return /^word\/(?:header|footer)\d+\.xml$/i.test(name) ? [name] : []
    })
    .filter((name, index, names) => names.indexOf(name) === index)

  const header: string[] = []
  const footer: string[] = []
  for (const name of referencedParts) {
    const partPayload = payloads.get(name)
    if (!partPayload) {
      if (visualContent === 'absent') visualContent = 'unknown'
      continue
    }
    const relationshipsName = posix.join(
      posix.dirname(name),
      '_rels',
      `${posix.basename(name)}.rels`,
    )
    const relationshipsPayload = payloads.get(relationshipsName)
    const partXml = new TextDecoder().decode(partPayload)
    const partRelationshipsXml = relationshipsPayload
      ? new TextDecoder().decode(relationshipsPayload)
      : ''
    if (hasDocxVisualContent(partXml, partRelationshipsXml))
      visualContent = 'present'
    const text = extractWordXmlText(partXml)
    if (!text) continue
    ;(/^word\/header/i.test(name) ? header : footer).push(text)
  }
  return {
    header,
    footer,
    notes: readDocxNoteBodies(payloads).map(formatDocxNoteBody),
    visualContent,
  }
}

export async function readDocxSupplementalContent(
  buffer: Buffer,
  limits: OoxmlPackageLimits,
  extract: NonNullable<
    DocumentExtractionDependencies['extractDocxSupplementalContent']
  >,
) {
  try {
    return await extract(buffer, limits)
  } catch (error) {
    console.warn('DOCX header/footer extraction warning', {
      reason: error instanceof Error ? error.message : 'Unknown archive error.',
    })
    return {
      header: [],
      footer: [],
      notes: [],
      visualContent: 'unknown',
    }
  }
}
