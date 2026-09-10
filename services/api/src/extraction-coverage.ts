import { loadOoxmlZipEntries } from '@obiter/ooxml'
import {
  decodeXmlText,
  extractWordXmlText,
  normaliseFileType,
  readDocxNoteBodies,
} from './document-extraction'

// Extraction coverage guard: redaction must not finalise over regions it never
// examined. Size note: this module holds the .docx denylist, the PDF signals,
// and their dispatch in one file (over the usual ceiling) because they are one
// guard sharing one threshold and one region vocabulary; splitting would scatter
// a single safety argument across files. The .docx side is denylist by default: every part the package
// contains must be extracted into the reviewed text, provably empty of human
// text, explicitly refused when non-trivial, or safely stripped at burn. An
// unclassified part refuses. The classes, with why each is safe:
// - word/document.xml body w:t: read by mammoth, the extraction itself.
// - Referenced headers/footers and footnote/endnote bodies: read by the
//   supplemental pass (E43 appends notes as a labelled trailing region), and
//   re-checked below by presence in the extracted text, so an unreferenced
//   part or a stale (pre-E43) text still refuses.
// - [Content_Types].xml and every *.rels: package machinery (MIME manifest,
//   part paths, ids, hyperlink targets). URLs are addresses, never reviewable
//   prose; the burn-time whole-package byte gate still refuses when an
//   accepted span overlaps one.
// - docProps/thumbnail.*: stripped at burn (a stale rendering would otherwise
//   leak the unredacted first page), so coverage needs no refusal.
// - Company/Manager/Template scalars: stripped at burn like authorship, so
//   coverage treats them as stripped-safe. Longer-lived text scalars (title,
//   subject, keywords, description, category, creator, lastModifiedBy) refuse
//   when non-trivial and unexamined: a client name there means the reviewer
//   never saw it, and the fix is to clear it in Word and re-upload.
// - Style names, numbering level patterns, font names: template vocabulary,
//   never rendered as document prose. Prose smuggled into those parts
//   (w:t/delText/a:t/m:t/instrText) still refuses. A style or level label
//   carrying exfiltrated text under the size floor is the accepted residual.
// - word/media/* images: pixels, which text extraction cannot read by design
//   (the visual-content signal at upload already warns on image-only docs).
// - Tracked insertions/moves-to and property changes: ins/moveTo w:t is live
//   text mammoth extracts, so spans address it; pPrChange/rPrChange carry
//   formatting only. Deleted and moved-from text (w:delText, w:t inside
//   w:del/w:moveFrom) is invisible to extraction, so any of it that is absent
//   from the extracted text refuses at any size: it is revision history the
//   reviewer never saw, and the burn refuses accepted-span overlap in both
//   directions.
// Residual risks, deliberately not covered: drawing VML text outside
// w:txbxContent, structured-document-control edge cases, field-code text
// (FILENAME/AUTHOR fields can name users — the byte gate covers span
// overlap), external URL targets, style-name exfiltration under the floor,
// and short (<20 char) unexamined fragments anywhere. Short tracked-deletion
// text is the exception: it refuses at any size.

// Parts with fewer non-whitespace chars than this are ignored so empty
// footnote separators and trivial fragments do not block clean documents.
export const UNEXAMINED_PART_MIN_CHARS = 20

// PDF fusion signals: zero-gap fused runs (adjacent Tj, no spaces) keep every
// char, so char-ratio shows ~zero loss — the signal is run shape, not char
// count. Fused probe "HelloWorldthisisfused" (21 chars, 1 token) is NOT
// rescued by withSemanticSpaces. Two signals, either of which refuses:
// - Long-token share: whole fused lines run to 100+ chars, so N=30 with >=5%
//   share catches systemic fusion; longest>=100 catches a single fused line
//   hiding in a long document.
// - Long letter-run share: the observed collapse artifact peaked at an
//   18-letter run (PARTICULARSOFCLAIM) with 0% of chars in tokens over 30,
//   so the token signal missed it. No token-length threshold can catch that
//   without flagging clean PDFs (the text-layer fixture carries a 24-char
//   spaceless token, amina.rahman@example.test), but letter runs separate
//   them: clean PDF fixtures peak at a 7-letter run (11 post-fix on an
//   all-caps claim-form probe: PARTICULARS) versus 18 fused, so N=16 with
//   >=10% letter share flags the artifact while clean fixtures pass with
//   margin. The 10% level (up from 5%) is measured, not guessed: ordinary
//   vocabulary already reaches N=16 (responsibilities/characterisation 16,
//   misrepresentation/unconscionability 17, disproportionately 18), and
//   four synthetic clean shorts trip the old 5% gate — one long word in a
//   ~325-letter note is 5.1-5.3%, two in ~425-432 letters is 7.5-8.1% —
//   while the fused probe sits at 18/112 letters = 16.1%. At 10% the probe
//   flags with 6.1pp margin and the densest clean short passes with 1.9pp.
//   The 50-letter floor skips degenerate fragments where one word owns the
//   share (the probe at 112 letters keeps 62 of margin). Two gates were
//   measured and rejected: distinct>=2 would blind the guard to the
//   observed artifact (it carries exactly one 16+ run), and an absolute
//   long-run-chars minimum points the wrong way (fused 18 < clean
//   two-word 32-35). The share gate (not longest alone) keeps a single
//   legit long word in a long document passing.
// Cannot detect fusion that yields only sub-N runs (e.g. an alphanumeric
// fusion such as NUMBERQQ123456CWAS, letter runs 8+3 — mitigated because the
// observed producer fuses whole all-caps lines, which still trip the run
// signal), a single legit 16+ letter word in a very short document, or
// over-spaced text (handled nowhere). Scanned PDFs are handled separately
// via MINIMUM_PDF_CHARS_PER_PAGE. Thresholds validated against clean
// fixtures in extraction-coverage.test.ts; recalibrate on real fused runs.
export const FUSED_TOKEN_MIN_LENGTH = 30
export const FUSED_TOKEN_CHAR_SHARE = 0.05
export const FUSED_TOKEN_ABSOLUTE_LENGTH = 100
export const FUSED_LETTER_RUN_MIN_LENGTH = 16
export const FUSED_LETTER_RUN_SHARE = 0.1
// Share is meaningless below a sentence or two: one word owns the ratio.
export const FUSED_LETTER_RUN_MIN_TOTAL_LETTERS = 50

function nonWhitespaceChars(value: string) {
  return [...value].filter((ch) => !/\s/u.test(ch)).length
}

function regionLabel(name: string, chars: number) {
  return `${name} (${chars} chars not examined)`
}

/**
 * Non-whitespace chars of note bodies of one kind that are absent from the
 * extracted text. Extraction appends each body verbatim inside its label, so
 * a body present in the text is covered; anything else (including runs
 * extracted before E43) is not.
 */
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

/** Non-whitespace chars of `text` that `extractedText` does not contain. */
function unexaminedChars(text: string, extractedText: string) {
  if (!text || nonWhitespaceChars(text) === 0) return 0
  if (extractedText.includes(text)) return 0
  return nonWhitespaceChars(text)
}

/** Visible prose carriers inside config/template parts. */
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

/**
 * Deleted and moved-from revision text per block: w:t/w:delText inside
 * w:del and w:moveFrom, plus stray w:delText outside any block
 * (belt and braces for producer variants). Insertions and moves-to are live
 * text extraction already reads, so they are not revision residue.
 */
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

/** a:t drawing-textbox prose inside the main document body. */
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

/**
 * Character data of a custom-vocabulary part (customXml, charts) or an
 * unclassified/altChunk XML part. An index-based scan, not a tag-strip
 * regex: single-pass multi-character `<...>` removal is the incomplete
 * multi-character sanitization CodeQL flags, and it is genuinely lossy
 * (`<<script>script>` strips to `<script>`, dropping smuggled text this guard
 * must count). This walk reads every run between markup tokens, so no run is
 * dropped; `>` inside an attribute or comment is treated as text, which
 * over-counts — the safe direction for a refuse-guard. CDATA content is real
 * character data, so it is included verbatim (entities there are literal,
 * never decoded).
 */
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
      // Unterminated markup token: keep the remainder as text, never drop it.
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

/** altChunk targets: rel-typed aFChunk parts, w:altChunk references, stray HTML. */
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

/** w:t chars inside w:txbxContent blocks of the main document body. */
export function countBodyTextboxChars(documentXml: string) {
  let chars = 0
  const blocks = /<w:txbxContent[\s\S]*?<\/w:txbxContent>/gi
  for (const block of documentXml.matchAll(blocks))
    chars += nonWhitespaceChars(extractWordXmlText(block[0]))
  return chars
}

/**
 * Regions of a .docx source that extraction never reads. Denylist by
 * default: every part the package contains is required to be extracted,
 * provably empty, explicitly refused, or safely stripped at burn. The
 * classifier below names each known class; anything unclassified refuses.
 * Footnote/endnote bodies are covered when the extracted text contains them
 * (E43 appends them as a labelled trailing region), so runs extracted before
 * E43 still refuse.
 */
export async function findUncoveredDocxRegions(
  sourceBytes: Buffer,
  extractedText = '',
): Promise<string[]> {
  let entries: Map<string, Uint8Array>
  try {
    entries = await loadOoxmlZipEntries(sourceBytes)
  } catch {
    // Unreadable here means extraction already failed upstream; nothing to add.
    return []
  }
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
  if (uncoveredFootnoteChars >= UNEXAMINED_PART_MIN_CHARS)
    regions.push(regionLabel('footnotes', uncoveredFootnoteChars))
  const uncoveredEndnoteChars = uncoveredNoteChars(
    entries,
    extractedText,
    'endnote',
  )
  if (uncoveredEndnoteChars >= UNEXAMINED_PART_MIN_CHARS)
    regions.push(regionLabel('endnotes', uncoveredEndnoteChars))

  // Headers/footers: covered when the supplemental pass carried them into
  // the extracted text, which also catches parts nothing references.
  for (const [name, xml] of storyXml) {
    if (!/^word\/(header|footer)/i.test(name)) continue
    pushChars(name, unexaminedChars(extractWordXmlText(xml), extractedText))
  }

  // Tracked deletions and moves-from are invisible to extraction, so any
  // block absent from the extracted text refuses at any size.
  for (const [name, xml] of storyXml) {
    let chars = 0
    for (const block of trackedRevisionBlocks(xml))
      chars += unexaminedChars(block, extractedText)
    if (chars > 0)
      regions.push(`tracked changes in ${name} (${chars} chars not examined)`)
  }

  // Comments (and modern comment-author lists) are never extracted.
  for (const [name] of entries) {
    const lower = name.toLowerCase()
    const label = /^word\/comments.*\.xml$/i.test(lower)
      ? 'comments'
      : /^word\/people.*\.xml$/i.test(lower)
        ? 'comment authors'
        : null
    if (!label) continue
    pushChars(label, nonWhitespaceChars(wordPartText(entries, name)))
  }

  const documentXml = storyXml.get('word/document.xml')
  if (documentXml) {
    // Body VML textboxes are dropped by mammoth; drawing textboxes the same.
    pushChars('textboxes', countBodyTextboxChars(documentXml))
    pushChars(
      'drawing textboxes',
      unexaminedChars(bodyDrawingText(documentXml), extractedText),
    )
  }

  // altChunk parts are whole embedded documents extraction never reads.
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

  // docProps text scalars the reviewer never sees. Company/Manager/Template
  // are stripped at burn like authorship, so only content-bearing scalars
  // refuse here.
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

  // Template/config parts carry no prose in ordinary documents; any prose
  // carrier text (w:t, deletions, drawing/math/field text) refuses. Style
  // names, numbering patterns, and font names are template vocabulary and
  // are not treated as prose (see the module header for the residual).
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

  // The inversion: anything not classified above refuses. XML parts are
  // text-scanned (custom vocabularies included); binary parts cannot prove
  // themselves empty of text. Images under word/media are the one exception:
  // pixels, which text extraction cannot read by design.
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

/** Fused-text regions of extracted PDF text, via the long-token signal. */
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

/**
 * Unexamined regions for a finalize candidate. Null sourceBytes means no
 * stored source was recorded (legacy runs predate the guard), so there is
 * nothing to compare against and this returns []. The caller marks those
 * runs unchecked; a stored source that fails to read never reaches here —
 * the caller refuses finalisation instead, since an unreadable source is
 * not evidence of coverage. Txt sources return [] by design (nothing
 * outside the extracted text can hide).
 */
export async function findUncoveredRegions(input: {
  filename: string
  mimeType: string | null
  sourceBytes: Buffer | null
  extractedText: string
}): Promise<string[]> {
  const kind = classifySource(input.filename, input.mimeType)
  if (kind === 'pdf') return findUncoveredPdfRegions(input.extractedText)
  if (kind !== 'docx' || !input.sourceBytes) return []
  return findUncoveredDocxRegions(input.sourceBytes, input.extractedText)
}
