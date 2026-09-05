import JSZip from 'jszip'
import {
  applyRunTextReplacementRange,
  loadOoxmlZipEntries,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  affectsOutput,
  RedactionSpanIntegrityError,
  type Decisions,
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

/**
 * Thrown when a .docx cannot be burned safely. Finalize catches this and
 * falls back to text output (which carries no OOXML container, so delText,
 * metadata, comments, and embedded parts cannot leak through it).
 */
export class RedactionDocxBurnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RedactionDocxBurnError'
  }
}

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

/**
 * Burn accepted redaction spans into a .docx, keeping styles and structure
 * intact: covered w:t content is replaced with [REDACTED] / [TOKEN] inside
 * the existing runs (split at span boundaries via the editor's
 * applyRunTextReplacementRange, which shares the locateOffset / runPieceXml
 * split machinery of range formatting), while document metadata authorship
 * fields are emptied. Fails closed (throws RedactionDocxBurnError) when any
 * accepted span text survives anywhere in the package.
 */
export async function buildRedactedDocx(
  input: RedactedDocxInput,
): Promise<Uint8Array> {
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
    document = await parseDocx(Uint8Array.from(input.docxBytes))
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

  // Tracked-change content (w:delText, inserted/moved w:t) is excluded from
  // the document model and from extracted text, so spans can never address
  // it. Refuse when it carries redacted text; the text fallback carries no
  // tracked changes, so refusing here cannot leak.
  for (const change of document.trackedChanges.values()) {
    if (!change.wire.text) continue
    const hit = affected.find(
      (span) => span.text !== '' && change.wire.text.includes(span.text),
    )
    if (hit) {
      throw new RedactionDocxBurnError(
        `The source holds redacted text inside a tracked change (${change.wire.elementName}), which redaction does not cover.`,
      )
    }
  }

  for (const story of document.model.stories) {
    if (!REDACTABLE_STORY_KINDS.has(story.kind)) continue
    for (const paragraph of story.paragraphs) {
      const anchor = document.paragraphAnchors.get(paragraph.id)
      if (!anchor) continue
      const paragraphText = anchor.runs.map((run) => run.wire.text).join('')
      if (!paragraphText) continue
      const hits: Array<{ from: number; to: number; text: string }> = []
      for (const span of affected) {
        if (!span.text) continue
        const replacement = replacements.get(span.id) ?? '[REDACTED]'
        let cursor = 0
        for (;;) {
          const index = paragraphText.indexOf(span.text, cursor)
          if (index === -1) break
          hits.push({
            from: index,
            to: index + span.text.length,
            text: replacement,
          })
          cursor = index + span.text.length
        }
      }
      if (hits.length > 0) {
        applyRunTextReplacementRange(document, anchor, hits)
      }
    }
  }

  const serialised = await serialiseDocx(document)
  const stripped = await stripDocumentAuthorship(serialised)
  assertNoSpanTextSurvives(stripped, affected)
  return stripped
}

/**
 * A redacted document naming its author in metadata has disclosed something.
 * Empty the authorship fields Word writes (dc:creator, cp:lastModifiedBy,
 * Company, Manager); dates, revision counts, and template names stay.
 */
async function stripDocumentAuthorship(input: Uint8Array) {
  const zip = await JSZip.loadAsync(input)
  const scrubs: Array<[RegExp, string]> = [
    [/(<[^>]*\bcreator[^>]*>)[\s\S]*?(<\/[^>]*>)/i, 'docProps/core.xml'],
    [/(<[^>]*\blastModifiedBy[^>]*>)[\s\S]*?(<\/[^>]*>)/i, 'docProps/core.xml'],
    [/(<Company[^>]*>)[\s\S]*?(<\/Company[^>]*>)/, 'docProps/app.xml'],
    [/(<Manager[^>]*>)[\s\S]*?(<\/Manager[^>]*>)/, 'docProps/app.xml'],
  ]
  for (const [pattern, partName] of scrubs) {
    const file = zip.file(partName)
    if (!file) continue
    const xml = await file.async('string')
    if (!pattern.test(xml)) continue
    zip.file(partName, xml.replace(pattern, '$1$2'))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

/**
 * Fail-closed gate over the whole container: every part's raw bytes must be
 * free of every accepted span text. Covers custom XML, embedded objects,
 * comments residue, field codes, altChunks, and anything else the container
 * carries. rsids are hex run ids and cannot contain span text, so they need
 * no handling beyond this gate.
 */
async function assertNoSpanTextSurvives(
  bytes: Uint8Array,
  affected: RedactionSpan[],
) {
  const entries = await loadOoxmlZipEntries(Buffer.from(bytes))
  for (const span of affected) {
    if (!span.text) continue
    const needle = Buffer.from(span.text, 'utf8')
    for (const [name, payload] of entries) {
      if (Buffer.from(payload).includes(needle)) {
        throw new RedactionDocxBurnError(
          `Redacted text survives in ${name}; refusing .docx output.`,
        )
      }
    }
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
