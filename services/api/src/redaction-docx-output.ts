import { acceptedDocxOccurrences } from './redaction-docx-occurrences'
import { assertNoSpanTextSurvives } from './redaction-docx-residual'
import { mapDocxText } from './redaction-docx-map'
import { RedactionDocxBurnError } from './redaction-docx-error'
import { prepareDocxForBurn } from './redaction-docx-xml'
import JSZip from 'jszip'
import {
  loadOoxmlZipEntries,
  parseDocx,
  parseXmlElements,
  serialiseDocx,
  type OoxmlPackageLimits,
} from '@obiter/ooxml'
import {
  burnMappedNodes,
  normaliseRenderCharacters,
  scrubBurnedFields,
  scrubAcceptedMetadata,
  type BurnRange,
} from './redaction-docx-burn'
import {
  affectsOutput,
  coalesceRanges,
  RedactionSpanIntegrityError,
  type Decisions,
  type RedactionSpan,
  type TokenMap,
} from '@obiter/redaction-policy'

export interface RedactedDocxInput {
  ooxmlLimits?: OoxmlPackageLimits
  docxBytes: Buffer
  text: string
  spans: RedactionSpan[]
  decisions: Decisions
  outputMode: 'redacted' | 'pseudonymised'
  tokenMap: TokenMap
}

export { RedactionDocxBurnError } from './redaction-docx-error'

function replacementForSpan(
  span: RedactionSpan,
  outputMode: RedactedDocxInput['outputMode'],
  tokensByEntity: ReadonlyMap<string, string>,
) {
  if (outputMode === 'redacted') return '[REDACTED]'
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
  const expanded = acceptedDocxOccurrences(input.text, input.spans, input.decisions)
  const affected = expanded.spans.filter((span) => affectsOutput(expanded.decisions[span.id]))
  for (const span of affected) {
    if (input.text.slice(span.start, span.end) !== span.text) {
      throw new RedactionSpanIntegrityError(span.id)
    }
  }
  const tokensByEntity = new Map(
    Object.entries(input.tokenMap).map(([token, value]) => [
      `${token.slice(0, token.lastIndexOf('_'))?.toLowerCase()}:${value}`,
      token,
    ]),
  )
  const replacements = new Map(
    affected.map((span) => [
      span.id,
      replacementForSpan(span, input.outputMode, tokensByEntity),
    ]),
  )

  let document
  const prepared = await prepareDocxForBurn(input.docxBytes, input.ooxmlLimits)
  try {
    document = await parseDocx(prepared, {limits: input.ooxmlLimits})
  } catch {
    throw new RedactionDocxBurnError('The source document could not be read.')
  }

  const sourceEntries = await loadOoxmlZipEntries(Buffer.from(prepared), input.ooxmlLimits)
  const mapped = mapDocxText(sourceEntries)
  for (const partName of new Set(mapped.nodes.map((node) => node.partName))) {
    const part = document.sourceParts.get(partName)
    if (part && !part.overlay)
      part.overlay = {
        source: new TextDecoder('utf-8', { fatal: true }).decode(
          part.originalPayload,
        ),
        replacements: new Map(),
      }
  }
  // Legacy Mammoth runs are usable only when their complete stored text agrees.
  // Never realign by searching: duplicates make that intrinsically ambiguous.
  if (mapped.text !== input.text.trim())
    throw new RedactionDocxBurnError(
      'Stored extraction coordinates differ from the Word document; create a new redaction run from a fresh upload.',
      'legacy_coordinates',
    )
  const leading = input.text.length - input.text.trimStart().length
  for (const node of mapped.nodes) {
    node.start += leading
    node.end += leading
  }
  const ranges = affected.map((span) => ({
    start: span.start,
    end: span.end,
    spanId: span.id,
  }))
  const hits: BurnRange[] =
    input.outputMode === 'redacted'
      ? coalesceRanges(input.text, ranges).map((range) => ({
          from: range.start,
          to: range.end,
          text: '[REDACTED]',
          black: true,
        }))
      : affected.map((span) => ({
          from: span.start,
          to: span.end,
          text: replacements.get(span.id) ?? '[REDACTED]',
        }))
  const union: BurnRange[] = []
  for (const hit of hits.sort((a, b) => a.from - b.from || b.to - a.to)) {
    const previous = union.at(-1)
    if (previous && hit.from < previous.to)
      previous.to = Math.max(previous.to, hit.to)
    else union.push({ ...hit })
  }
  const burned = burnMappedNodes(document, mapped.nodes, union)
  scrubBurnedFields(document, burned, affected.map(span => span.text))
  scrubAcceptedMetadata(
    document,
    affected.map((span) => span.text),
  )
  if (input.outputMode === 'redacted')
    normaliseRenderCharacters(document, mapped.nodes)
  const serialised = await serialiseDocx(document)
  const writtenParts = await loadOoxmlZipEntries(Buffer.from(serialised), input.ooxmlLimits)
  // Independent output proof: rebuild reviewed text from the emitted package
  // and compare it to offset edits, including preserved synthetic separators.
  const edits: Array<{ start: number; end: number; value: string }> = []
  const emitted = new Set<BurnRange>()
  let firstSpan = 0
  for (const node of mapped.nodes) {
    while ((union[firstSpan]?.to ?? Infinity) <= node.start) firstSpan++
    for (let i = firstSpan; i < union.length; i++) {
      const span = union[i]
      if (!span || span.from >= node.end) break
      const start = Math.max(node.start, span.from)
      const end = Math.min(node.end, span.to)
      if (start >= end) continue
      edits.push({ start, end, value: emitted.has(span) ? '' : span.text })
      emitted.add(span)
    }
  }
  let expected = ''
  let cursor = 0
  for (const edit of edits) {
    expected += input.text.slice(cursor, edit.start) + edit.value
    cursor = edit.end
  }
  expected += input.text.slice(cursor)
  if (mapDocxText(writtenParts).text !== expected.trim())
    throw new RedactionDocxBurnError(
      'The emitted document does not match the accepted redaction coordinates.',
    )
  const stripped = await stripDocumentAuthorship(serialised)
  const preserved = input.spans.filter(span => ['reject', 'override_keep'].includes(input.decisions[span.id]?.decision ?? '')).flatMap(span => {
    if (edits.some(edit => edit.start < span.end && edit.end > span.start)) return []
    const delta = edits.filter(edit => edit.end <= span.start).reduce((sum, edit) => sum + edit.value.length - (edit.end - edit.start), 0)
    return [{...span, start: span.start + delta - leading, end: span.end + delta - leading}]
  })
  await assertNoSpanTextSurvives(stripped, affected, preserved, input.ooxmlLimits)
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
