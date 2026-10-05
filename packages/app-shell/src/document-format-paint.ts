import type {
  DocumentModelWire,
  DocumentNumberingWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  buildOverrideFragment,
  hasPureStartOverride,
  patchParagraphFormatXml,
  patchRunEmphasisXml,
} from '@obiter/ooxml'
import { xmlAttr, xmlTagAttrs } from './document-page-units'
import type {
  FormatDrafts,
  NumberingDraft,
  ParagraphFormatDraft,
  PendingEmphasis,
} from './document-format-types'

export function formattedModel(
  model: DocumentModelWire,
  format: FormatDrafts,
): DocumentModelWire {
  const emphasisByRun = runEmphasisIndex(format)
  const numbering = paintedNumbering(model, format)
  const paintedFormat = numbering.instances.length
    ? { ...format, numbering: numbering.drafts }
    : format
  return {
    ...model,
    numbering: numbering.instances.length
      ? [...model.numbering, ...numbering.instances]
      : model.numbering,
    stories: model.stories.map((story) => ({
      ...story,
      paragraphs: story.paragraphs.map((paragraph) =>
        formattedParagraph(paragraph, paintedFormat, emphasisByRun),
      ),
    })),
  }
}

/**
 * Drafts whose restart the model cannot yet name. The server creates or reuses
 * an instance on save, so before that the paragraph's `w:numPr` still points at
 * the source and the markers would number on. Synthesising a private instance
 * for the draft — with the override folded into the paragraph's own level —
 * points the painted `w:numPr` at it so the marker visibly restarts now. A draft
 * that already names an instance carrying the override is left alone, so the
 * paint and the save agree on the instance id.
 */
function paintedNumbering(model: DocumentModelWire, format: FormatDrafts) {
  const drafts = { ...format.numbering }
  const instances: DocumentNumberingWire[] = []
  for (const [paragraphId, draft] of Object.entries(format.numbering)) {
    const start = draft.startOverride
    if (!draft.numId || start === undefined || start === null) continue
    const source = model.numbering.find(
      (instance) => instance.numberingId === draft.numId,
    )
    if (!source) continue
    const ilvl = draft.ilvl ?? 0
    if (hasPureStartOverride(source.sourceFragment, ilvl, start)) continue
    const abstractId = source.abstractNumberingId
    // The server refuses a restart whose source names no abstract numbering
    // (`resolveParagraphNumbering` throws invalid-document-edit), so a preview
    // that synthesised one would claim a restart the save rejects.
    if (!abstractId) continue
    // The server reuses an instance that already carries a pure override for
    // the same abstract numbering, level and start. Searching the model and
    // the instances synthesised earlier in this pass the same way makes two
    // paragraphs restarted in one action share one counter (1., 2.), not paint
    // one counter each (1., 1.) and diverge from the save.
    const matching = [...model.numbering, ...instances].find(
      (instance) =>
        instance.abstractNumberingId === abstractId &&
        hasPureStartOverride(instance.sourceFragment, ilvl, start),
    )
    if (matching) {
      drafts[paragraphId] = { ...draft, numId: matching.numberingId }
      continue
    }
    const numberingId = `draft:${paragraphId}`
    instances.push({
      numberingId,
      abstractNumberingId: abstractId,
      startOverride: start,
      // Mirror the server's created instance with the same builder, so a later
      // paragraph with this resolution tuple recognises it as reusable exactly
      // as the server recognises the instance it created.
      sourceFragment: buildOverrideFragment(
        source.sourceFragment,
        'w',
        abstractId,
        numberingId,
        ilvl,
        start,
      ),
      ...(source.levels
        ? {
            levels: source.levels.map((level) =>
              level.ilvl === ilvl ? { ...level, start } : { ...level },
            ),
          }
        : {}),
    })
    drafts[paragraphId] = { ...draft, numId: numberingId }
  }
  return { drafts, instances }
}

function runEmphasisIndex(format: FormatDrafts) {
  return new Map(
    format.emphasis.flatMap((item) =>
      item.runId ? [[item.runId, item] as const] : [],
    ),
  )
}

/**
 * One paragraph as `formattedModel` would hold it: the pending style,
 * numbering and run-level emphasis applied. Control state formats only the
 * paragraphs a selection addresses, so reading one selection never rebuilds
 * the whole model, and the result is the same object `formattedModel` would
 * produce for that paragraph.
 */
export function formattedParagraphDraft(
  paragraph: DocumentParagraphWire,
  format: FormatDrafts,
): DocumentParagraphWire {
  return formattedParagraph(paragraph, format, runEmphasisIndex(format))
}

/**
 * Projects range emphasis onto one paragraph's current text. Offsets are in
 * that string, so the caller passes the paragraph after text drafts are
 * applied. Slicing first and then writing the draft onto the slice that kept
 * the original run id repeats the draft in front of the leftover tail.
 */
export function projectRangeEmphasis(
  paragraph: DocumentParagraphWire,
  emphasis: readonly PendingEmphasis[],
): DocumentParagraphWire {
  let current = paragraph
  for (const item of emphasis) {
    current = paintRangeEmphasis(current, item)
  }
  return current
}

export function paragraphStyleOptions(model: DocumentModelWire) {
  const seen = new Set<string>()
  const options: Array<{ styleId: string; name: string }> = []
  for (const style of model.styles) {
    if (seen.has(style.styleId)) continue
    if (!isParagraphStyle(style.sourceFragment)) continue
    seen.add(style.styleId)
    options.push({
      styleId: style.styleId,
      name:
        xmlAttr(xmlTagAttrs(style.sourceFragment, 'name'), 'val') ??
        style.styleId,
    })
  }
  return options
}

/**
 * A `w:style` is a paragraph style unless it explicitly names another kind.
 * OOXML defaults an omitted `w:type` to paragraph, so requiring the attribute
 * would drop a valid style; excluding the named non-paragraph kinds keeps a
 * character style out of the gallery.
 */
function isParagraphStyle(sourceFragment: string) {
  const type = sourceFragment.match(/w:type\s*=\s*["']([^"']*)["']/iu)?.[1]
  return type === undefined || type === 'paragraph'
}
function paintRangeEmphasis(
  paragraph: DocumentParagraphWire,
  item: PendingEmphasis,
): DocumentParagraphWire {
  if (item.paragraphId !== paragraph.id) return paragraph
  const from = item.from
  const to = item.to
  if (from === undefined || to === undefined) return paragraph
  const runs: DocumentParagraphWire['runs'] = []
  let cursor = 0
  let changed = false
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    const overlapFrom = Math.max(from, cursor)
    const overlapTo = Math.min(to, end)
    if (overlapFrom >= overlapTo) {
      runs.push(run)
    } else {
      const localFrom = snapRangeStart(run.text, overlapFrom - cursor)
      const localTo = snapRangeEnd(run.text, overlapTo - cursor)
      if (localFrom >= localTo) {
        runs.push(run)
      } else {
        changed = true
        const pieces: DocumentParagraphWire['runs'] = []
        if (localFrom > 0) {
          pieces.push({ ...run, text: run.text.slice(0, localFrom) })
        }
        pieces.push({
          ...run,
          text: run.text.slice(localFrom, localTo),
          preservedXmlFragments: patchFragments(
            run.preservedXmlFragments,
            emphasisXml(run.preservedXmlFragments, item),
            /<w:rPr\b/u,
          ),
        })
        if (localTo < run.text.length) {
          pieces.push({ ...run, text: run.text.slice(localTo) })
        }
        pieces.forEach((piece, index) => {
          runs.push(
            index === 0
              ? piece
              : {
                  ...piece,
                  id: `${run.id}:${String(localFrom)}:${String(localTo)}:${String(index)}`,
                },
          )
        })
      }
    }
    cursor = end
  }
  if (!changed) return paragraph
  return { ...paragraph, runs }
}

/** Expands a range so neither edge falls inside a surrogate pair. */
export type EmphasisRange = {
  from: number
  to: number
}

export function snapEmphasisRange(
  text: string,
  from: number,
  to: number,
): EmphasisRange {
  const start = snapRangeStart(text, Math.min(from, to))
  const end = snapRangeEnd(text, Math.max(from, to))
  return { from: start, to: Math.max(start, end) }
}

function snapRangeStart(text: string, index: number): number {
  return index > 0 && isLowSurrogate(text.charCodeAt(index)) ? index - 1 : index
}

function snapRangeEnd(text: string, index: number): number {
  return isLowSurrogate(text.charCodeAt(index))
    ? Math.min(text.length, index + 1)
    : index
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function formattedParagraph(
  paragraph: DocumentParagraphWire,
  format: FormatDrafts,
  emphasisByRun: ReadonlyMap<string, PendingEmphasis>,
): DocumentParagraphWire {
  const styleId = format.paragraphStyles[paragraph.id]
  const numbering = format.numbering[paragraph.id]
  const paragraphFormat = format.paragraphFormats[paragraph.id]
  return {
    ...paragraph,
    ...(styleId !== undefined
      ? styleId === null
        ? { styleId: undefined }
        : { styleId }
      : {}),
    preservedXmlFragments: paragraphPropertiesFragments(
      paragraph,
      numbering,
      paragraphFormat,
    ),
    runs: paragraph.runs.map((run) => {
      const emphasis = emphasisByRun.get(run.id)
      if (!emphasis) return run
      return {
        ...run,
        preservedXmlFragments: patchFragments(
          run.preservedXmlFragments,
          emphasisXml(run.preservedXmlFragments, emphasis),
          /<w:rPr\b/u,
        ),
      }
    }),
  }
}

/**
 * Applies the pending style-independent paragraph layout and numbering to one
 * `w:pPr`. Formatting runs after numbering so both patches read the same
 * fragment; the server's `setParagraphFormat` and `setParagraphNumbering`
 * write the same elements, so paint and save cannot disagree.
 */
function paragraphPropertiesFragments(
  paragraph: DocumentParagraphWire,
  numbering: NumberingDraft | undefined,
  paragraphFormat: ParagraphFormatDraft | undefined,
) {
  if (!numbering && !paragraphFormat) return paragraph.preservedXmlFragments
  const current =
    paragraph.preservedXmlFragments.find((fragment) =>
      /<w:pPr\b/u.test(fragment),
    ) ?? '<w:pPr/>'
  let next = numbering ? numberingXml(current, numbering) : current
  if (paragraphFormat) {
    next = patchParagraphFormatXml(next, paragraphFormat)
  }
  return patchFragments(paragraph.preservedXmlFragments, next, /<w:pPr\b/u)
}

function numberingXml(fragment: string, numbering: NumberingDraft) {
  const base =
    fragment.trim() === '' || /\/\s*>$/u.test(fragment)
      ? '<w:pPr/>'
      : strip(fragment, 'numPr')
  if (numbering.numId === null) return base
  const numPr = `<w:numPr><w:ilvl w:val="${String(numbering.ilvl ?? 0)}"/><w:numId w:val="${numbering.numId}"/></w:numPr>`
  if (/\/\s*>$/u.test(base)) {
    return `${base.replace(/\/\s*>$/u, '>')}${numPr}</w:pPr>`
  }
  return base.replace(/(<\/[^>]+>)$/u, `${numPr}$1`)
}

function emphasisXml(fragments: readonly string[], emphasis: PendingEmphasis) {
  const current =
    fragments.find((fragment) => /<w:rPr\b/u.test(fragment)) ?? '<w:rPr/>'
  // The server's save path writes run emphasis through the same function, so a
  // preview and the saved document cannot drift: it protects a nested
  // `w:rPrChange` history, escapes every attribute value and inserts each child
  // at its schema position rather than at the end of the fragment.
  return patchRunEmphasisXml(current, emphasis)
}

function strip(fragment: string, localName: string) {
  return fragment.replace(
    new RegExp(
      `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
      'u',
    ),
    '',
  )
}

function patchFragments(
  fragments: readonly string[],
  next: string,
  match: RegExp,
) {
  const index = fragments.findIndex((fragment) => match.test(fragment))
  if (index === -1) return [...fragments, next]
  return fragments.map((fragment, fragmentIndex) =>
    fragmentIndex === index ? next : fragment,
  )
}
