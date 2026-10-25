import { RedactionDocxBurnError } from './redaction-docx-error'
import { decodedXmlText, prepareDocxForBurn } from './redaction-docx-xml'
import JSZip from 'jszip'
import {
  loadOoxmlZipEntries,
  parseDocx,
  parseXmlElements,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  burnParagraph,
  paragraphBurnText,
  scrubBurnedFields,
  type BurnRange,
} from './redaction-docx-burn'
import {
  affectsOutput,
  coalesceRanges,
  RedactionSpanIntegrityError,
  type Decisions,
  type RedactionRange,
  type RedactionSpan,
  type TokenMap,
} from '@obiter/redaction-policy'

export interface RedactedDocxInput {
  docxBytes: Buffer
  text: string
  spans: RedactionSpan[]
  decisions: Decisions
  outputMode: 'redacted' | 'pseudonymised'
  tokenMap: TokenMap
}

export { RedactionDocxBurnError } from './redaction-docx-error'

const REDACTABLE_STORY_KINDS = new Set([
  'document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
])

function replacementForSpan(
  span: RedactionSpan,
  outputMode: RedactedDocxInput['outputMode'],
  tokenMap: TokenMap,
) {
  if (outputMode === 'redacted') return '[REDACTED]'
  const tokensByEntity = new Map(
    Object.entries(tokenMap).map(([token, value]) => [
      `${token.slice(0, token.lastIndexOf('_'))?.toLowerCase()}:${value}`,
      token,
    ]),
  )
  const token = tokensByEntity.get(`${span.category}:${span.text}`)
  if (!token)
    throw new RedactionDocxBurnError(`Missing pseudonym token for redaction.`)
  return `[${token}]`
}

/** Burn with Redact-owned XML replacements, then refuse any residual span text. */
export async function buildRedactedDocx(
  input: RedactedDocxInput,
): Promise<Uint8Array> {
  try {
    return await burnRedactedDocx(input)
  } catch (error) {
    if (
      error instanceof RedactionDocxBurnError ||
      error instanceof RedactionSpanIntegrityError
    )
      throw error
    // Never return uncertain bytes or expose parser/provider internals to callers.
    throw new RedactionDocxBurnError(
      'The document could not be redacted safely.',
    )
  }
}

async function burnRedactedDocx(input: RedactedDocxInput): Promise<Uint8Array> {
  const affected = input.spans.filter((span) =>
    affectsOutput(input.decisions[span.id]),
  )
  for (const span of affected) {
    if (input.text.slice(span.start, span.end) !== span.text) {
      throw new RedactionSpanIntegrityError(span.id)
    }
  }
  const replacements = new Map(
    affected.map((span) => [
      span.id,
      replacementForSpan(span, input.outputMode, input.tokenMap),
    ]),
  )

  let document
  try {
    document = await parseDocx(await prepareDocxForBurn(input.docxBytes))
  } catch {
    throw new RedactionDocxBurnError('The source document could not be read.')
  }

  for (const story of document.model.stories) {
    if (
      story.kind === 'comments' &&
      story.paragraphs.some((p) => p.runs.some((r) => r.text.trim() !== ''))
    ) {
      throw new RedactionDocxBurnError(
        'The source contains comments, which redaction does not cover.',
      )
    }
  }

  // Tracked-change content (w:delText, deleted/moved w:t) is excluded from
  // the document model and from extracted text, so spans can never address
  // it. Refuse when it carries redacted text, in either direction: the
  // change holding the whole span (residual copy survives the burn), or the
  // change holding part of an accepted span ("Alice" in a w:del while
  // "Alice Smith" burns to [REDACTED] still discloses the first name).
  // The partial direction needs a floor — single characters of revision
  // residue disclose nothing — so only subsumed changes of at least a few
  // non-whitespace characters refuse. The text fallback carries no tracked
  // changes, so refusing here cannot leak.
  // Minimum subsumed revision text that still discloses something worth
  // refusing over (first names and longer); shorter residue is noise.
  const MIN_PARTIAL_TRACKED_CHARS = 4
  for (const change of document.trackedChanges.values()) {
    if (!change.wire.text) continue
    const hit = affected.find((span) => {
      if (!span.text) return false
      if (change.wire.text.includes(span.text)) return true
      return (
        change.wire.text.replace(/\s+/gu, '').length >=
          MIN_PARTIAL_TRACKED_CHARS && span.text.includes(change.wire.text)
      )
    })
    if (hit) {
      throw new RedactionDocxBurnError(
        `The source holds redacted text inside a tracked change (${change.wire.elementName}), which redaction does not cover.`,
      )
    }
  }

  const burned = new Map<string, Array<{ start: number; end: number }>>()
  const covered = new Set<string>()
  for (const story of document.model.stories) {
    if (!REDACTABLE_STORY_KINDS.has(story.kind)) continue
    const paragraphs = story.paragraphs.map((paragraph) => {
      const anchor = document.paragraphAnchors.get(paragraph.id)
      if (!anchor)
        throw new RedactionDocxBurnError(
          'Redaction paragraph anchor is unavailable.',
        )
      return { anchor, text: paragraphBurnText(document, anchor) }
    })
    const piecesByParagraph: Array<
      Array<RedactionRange & { replacement: string }>
    > = paragraphs.map(() => [])
    // Supplemental XML uses one newline; Mammoth body extraction uses two.
    for (const separator of ['\n', '\n\n']) {
      const storyText = paragraphs
        .map((paragraph) => paragraph.text)
        .join(separator)
      const occurrences: Array<RedactionRange & { replacement: string }> = []
      for (const span of affected) {
        if (!span.text)
          throw new RedactionDocxBurnError('Empty accepted redaction.')
        let cursor = 0
        for (;;) {
          const index = storyText.indexOf(span.text, cursor)
          if (index === -1) break
          occurrences.push({
            start: index,
            end: index + span.text.length,
            spanId: span.id,
            replacement: replacements.get(span.id) ?? '[REDACTED]',
          })
          cursor = index + 1
        }
      }
      let offset = 0
      paragraphs.forEach(({ text }, index) => {
        const pieces = occurrences
          .filter((hit) => hit.start < offset + text.length && hit.end > offset)
          .map((hit) => ({
            ...hit,
            start: Math.max(0, hit.start - offset),
            end: Math.min(text.length, hit.end - offset),
          }))
        piecesByParagraph[index]?.push(...pieces)
        offset += text.length + separator.length
      })
    }
    for (const [index, { anchor, text }] of paragraphs.entries()) {
      const pieces = piecesByParagraph[index] ?? []
      const hits: BurnRange[] =
        input.outputMode === 'redacted'
          ? coalesceRanges(text, pieces).map((region) => ({
              from: region.start,
              to: region.end,
              text: '[REDACTED]',
              black: true,
            }))
          : pieces.map((piece) => ({
              from: piece.start,
              to: piece.end,
              text: piece.replacement,
            }))
      if (hits.length) {
        const ranges = burnParagraph(document, anchor, hits)
        if (!ranges.length)
          throw new RedactionDocxBurnError(
            'Accepted redaction could not be burned.',
          )
        for (const piece of pieces) covered.add(piece.spanId)
        burned.set(anchor.partName, [
          ...(burned.get(anchor.partName) ?? []),
          ...ranges,
        ])
      }
    }
  }
  if (affected.some((span) => !covered.has(span.id)))
    throw new RedactionDocxBurnError(
      'An accepted redaction has no burnable occurrence.',
    )

  scrubBurnedFields(document, burned)
  const serialised = await serialiseDocx(document)
  // The writer must prove that its run splitting produced well-formed XML.
  const writtenParts = await loadOoxmlZipEntries(Buffer.from(serialised))
  for (const part of document.sourceParts.values()) {
    if (!part.dirty) continue
    const payload = writtenParts.get(part.name)
    if (!payload)
      throw new RedactionDocxBurnError('A modified part is missing.')
    decodedXmlText(Buffer.from(payload).toString('utf8'))
  }
  await parseDocx(serialised)
  const stripped = await stripDocumentAuthorship(serialised)
  await assertNoSpanTextSurvives(stripped, affected)
  return stripped
}

/**
 * A redacted document naming its author in metadata has disclosed something.
 * Empty the authorship fields Word writes (dc:creator, cp:lastModifiedBy,
 * Company, Manager) plus the other free-text docProps scalars that can carry
 * client matter text unseen by the reviewer (dc:title, dc:subject,
 * cp:keywords, dc:description, cp:category, cp:contentStatus, Template) and
 * the arbitrary custom.xml properties. Counts, dates, revisions, producer
 * ids, stats, and hyperlink bases stay: functional or non-textual. The
 * thumbnail rendering is removed outright with its rel and content-type
 * entry — a stale first-page preview would otherwise leak the unredacted
 * document through the file manager. Coverage refuses non-trivial unexamined
 * text in these parts before the burn, so stripping here only ever removes
 * short residue the guard accepted.
 */
async function stripDocumentAuthorship(input: Uint8Array) {
  const zip = await JSZip.loadAsync(input)
  const scrubs = new Map([
    [
      'docProps/core.xml',
      new Set([
        'creator',
        'lastModifiedBy',
        'title',
        'subject',
        'keywords',
        'description',
        'category',
        'contentStatus',
      ]),
    ],
    ['docProps/app.xml', new Set(['Company', 'Manager', 'Template'])],
  ])
  for (const [partName, names] of scrubs) {
    const file = zip.file(partName)
    if (!file) continue
    const source = await file.async('string')
    const ranges = parseXmlElements(source).filter(
      (element) => names.has(element.localName) && !element.selfClosing,
    )
    let result = ''
    let cursor = 0
    for (const element of ranges) {
      if (element.startTagEnd < cursor) continue
      result += source.slice(cursor, element.startTagEnd)
      cursor = element.endTagStart
    }
    zip.file(partName, result + source.slice(cursor))
  }
  if (zip.file('docProps/custom.xml')) {
    zip.file(
      'docProps/custom.xml',
      '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>',
    )
  }
  for (const name of Object.keys(zip.files)) {
    if (/^docProps\/thumbnail\./i.test(name)) zip.remove(name)
  }
  const packageRels = zip.file('_rels/.rels')
  if (packageRels) {
    const xml = await packageRels.async('string')
    const stripped = xml.replace(
      /<Relationship\b[^>]*Target="[^"]*thumbnail[^"]*"[^>]*\/?>(?:<\/Relationship>)?/gi,
      '',
    )
    if (stripped !== xml) zip.file('_rels/.rels', stripped)
  }
  const contentTypes = zip.file('[Content_Types].xml')
  if (contentTypes) {
    const xml = await contentTypes.async('string')
    const stripped = xml.replace(
      /<Override\b[^>]*PartName="[^"]*thumbnail[^"]*"[^>]*\/?>(?:<\/Override>)?/gi,
      '',
    )
    if (stripped !== xml) zip.file('[Content_Types].xml', stripped)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/**
 * Fail-closed gate over the whole container: every part's raw bytes must be
 * free of every accepted span text, including decoded XML text and attributes.
 * Covers custom XML, embedded objects,
 * comments residue, field codes, altChunks, and anything else the container
 * carries. rsids are hex run ids and cannot contain span text, so they need
 * no handling beyond this gate.
 */
async function assertNoSpanTextSurvives(
  bytes: Uint8Array,
  affected: RedactionSpan[],
) {
  const entries = await loadOoxmlZipEntries(Buffer.from(bytes))
  const needles = affected
    .filter((span) => span.text)
    .map((span) => ({ text: span.text, bytes: Buffer.from(span.text, 'utf8') }))
  for (const [name, payload] of entries) {
    const decoded = /\.(?:xml|rels)$/iu.test(name)
      ? decodedXmlText(Buffer.from(payload).toString('utf8'))
      : []
    if (
      needles.some(
        (needle) =>
          Buffer.from(payload).includes(needle.bytes) ||
          decoded.some((text) => text.includes(needle.text)),
      )
    )
      throw new RedactionDocxBurnError(
        `Redacted text survives in ${name}; refusing .docx output.`,
      )
  }
}

export function redactedDocxFilename(sourceFilename: string) {
  const trimmed = sourceFilename.trim() || 'document.docx'
  if (/\.docx$/i.test(trimmed)) {
    return trimmed.replace(/\.docx$/i, '-redacted.docx')
  }
  return `${trimmed}-redacted.docx`
}

export function isDocxMimeOrFilename(
  filename: string,
  mimeType: string | null | undefined,
) {
  if (mimeType?.toLowerCase().includes('wordprocessingml')) return true
  return /\.docx$/i.test(filename)
}
