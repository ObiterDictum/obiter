import { loadOoxmlZipEntries } from '@obiter/ooxml'
import {
  extractWordXmlText,
  normaliseFileType,
  readDocxNoteBodies,
} from './document-extraction'

// Extraction coverage guard: redaction must not finalise over regions it never
// examined. E43 extracts word/footnotes.xml and word/endnotes.xml into a
// labelled trailing region ("[Footnote N] ..."), so the guard below treats
// a note body as covered only when that body is present in the extracted
// text — runs extracted before E43, or text that dropped the region, still
// refuse. Comments are deferred (review-thread authorship needs anchor and
// product decisions before merging into redaction text) and body textboxes
// are deferred (mid-sentence content needs inline placement, which shifts
// offsets and needs its own design); both still refuse. Fused-PDF and
// scanned-PDF signals are unchanged.

// Parts with fewer non-whitespace chars than this are ignored so empty
// footnote separators and trivial fragments do not block clean documents.
export const UNEXAMINED_PART_MIN_CHARS = 20

// PDF fusion signal: zero-gap fused runs (adjacent Tj, no spaces) keep every
// char, so char-ratio shows ~zero loss — the signal is long-token share, not
// char count. Fused probe "HelloWorldthisisfused" (21 chars, 1 token) is NOT
// rescued by withSemanticSpaces. Whole fused lines run to 100+ chars, so:
// N=30 with >=5% share catches systemic fusion; longest>=100 catches a single
// fused line hiding in a long document. Cannot detect fusion below N,
// over-spaced text (handled nowhere), or scanned PDFs (handled separately via
// MINIMUM_PDF_CHARS_PER_PAGE). Thresholds validated against clean fixtures in
// extraction-coverage.test.ts; recalibrate on real fused runs if needed.
export const FUSED_TOKEN_MIN_LENGTH = 30
export const FUSED_TOKEN_CHAR_SHARE = 0.05
export const FUSED_TOKEN_ABSOLUTE_LENGTH = 100

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

/** w:t chars inside w:txbxContent blocks of the main document body. */
export function countBodyTextboxChars(documentXml: string) {
  let chars = 0
  const blocks = /<w:txbxContent[\s\S]*?<\/w:txbxContent>/gi
  for (const block of documentXml.matchAll(blocks))
    chars += nonWhitespaceChars(extractWordXmlText(block[0]))
  return chars
}

/**
 * Regions of a .docx source that extraction never reads. Headers/footers
 * reached via document.xml.rels and document.xml itself are covered, and
 * footnote/endnote bodies are covered when the extracted text contains them
 * (E43 appends them as a labelled trailing region). Comments and body
 * textboxes are still reported whenever non-trivial.
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
  const candidates = [{ pattern: /^word\/comments.*\.xml$/i, name: 'comments' }]
  for (const [entryName] of entries) {
    const candidate = candidates.find((item) => item.pattern.test(entryName))
    if (!candidate) continue
    const chars = nonWhitespaceChars(wordPartText(entries, entryName))
    if (chars >= UNEXAMINED_PART_MIN_CHARS)
      regions.push(regionLabel(candidate.name, chars))
  }
  const documentPayload = entries.get('word/document.xml')
  if (documentPayload) {
    // Header/footer w:t (including any txbxContent there) is read by the
    // supplemental pass, but body textboxes are dropped by mammoth.
    const chars = countBodyTextboxChars(
      new TextDecoder().decode(documentPayload),
    )
    if (chars >= UNEXAMINED_PART_MIN_CHARS)
      regions.push(regionLabel('textboxes', chars))
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
