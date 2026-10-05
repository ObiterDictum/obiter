import type {
  DocumentEditOperation,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import { snapEmphasisRange } from './document-format-paint'
import { paragraphFormatFields } from './document-paragraph-format'
import { paragraphNumPr } from './document-page-lists'
import { findNumberingInstance } from './document-list-toggle'
import type {
  EmphasisPatch,
  FormatDrafts,
  NumberingDraft,
  PendingEmphasis,
} from './document-format-types'

export { paragraphNumPr } from './document-page-lists'
export type { ListKind } from './document-list-toggle'
export type {
  FormatDrafts,
  NumberingDraft,
  PendingEmphasis,
} from './document-format-types'
export { emptyFormatDrafts } from './document-format-types'
export {
  formatControlState,
  runFlagOn,
  selectedParagraph,
  selectedParagraphIds,
} from './document-format-controls'
export { formattedModel, paragraphStyleOptions } from './document-format-paint'
export {
  DEFAULT_INDENT_TWIPS,
  INDENT_OPTIONS,
  indentationPatch,
  LINE_SPACING_OPTIONS,
  lineSpacingPatch,
  paragraphFormatState,
  paragraphIndentLeftPx,
  setParagraphFormatDraft,
} from './document-paragraph-format'
export type {
  IndentKind,
  ParagraphFormatState,
} from './document-paragraph-format'
export { documentFormatToolbar } from './document-format-toolbar'
export type { FormatTarget, ParagraphRange } from './document-format-toolbar'

/**
 * The contract fields an emphasis draft restates, omitting the ones it leaves
 * untouched so a later merge does not clear a property this click did not act
 * on. Shared by the whole-run and range forms so they cannot drift.
 */
function emphasisProperties(item: PendingEmphasis): EmphasisPatch {
  return {
    ...(item.bold !== undefined ? { bold: item.bold } : {}),
    ...(item.italic !== undefined ? { italic: item.italic } : {}),
    ...(item.underline !== undefined ? { underline: item.underline } : {}),
    ...(item.strikethrough !== undefined
      ? { strikethrough: item.strikethrough }
      : {}),
    ...(item.fontFamily !== undefined ? { fontFamily: item.fontFamily } : {}),
    ...(item.fontSize !== undefined ? { fontSize: item.fontSize } : {}),
    ...(item.colour !== undefined ? { colour: item.colour } : {}),
    ...(item.highlight !== undefined ? { highlight: item.highlight } : {}),
    ...(item.vertAlign !== undefined ? { vertAlign: item.vertAlign } : {}),
    ...(item.smallCaps !== undefined ? { smallCaps: item.smallCaps } : {}),
  }
}

export function collectFormatOperations(
  model: DocumentModelWire,
  format: FormatDrafts,
  deletedParagraphIds: readonly string[],
  /**
   * Addresses that must not become their own operation because they belong to
   * something else in the same batch; a pending insert's style rides on the
   * insert operation. See document-edits collectEditOperations.
   */
  omitParagraphIds: ReadonlySet<string> = new Set(),
): DocumentEditOperation[] {
  const deleted = new Set(deletedParagraphIds)
  const deletedRuns = new Set(
    (documentStory(model)?.paragraphs ?? [])
      .filter((paragraph) => deleted.has(paragraph.id))
      .flatMap((paragraph) => paragraph.runs.map((run) => run.id)),
  )
  const operations: DocumentEditOperation[] = []
  const emphasisByRun = new Map<string, PendingEmphasis>()
  for (const item of format.emphasis) {
    if (item.runId && !deletedRuns.has(item.runId)) {
      emphasisByRun.set(item.runId, item)
    }
  }
  for (const item of emphasisByRun.values()) {
    if (!item.runId) continue
    operations.push({
      type: 'set_run_emphasis',
      runId: item.runId,
      ...emphasisProperties(item),
    })
  }
  for (const item of format.emphasis) {
    if (
      item.runId ||
      !item.paragraphId ||
      item.from === undefined ||
      item.to === undefined ||
      deleted.has(item.paragraphId)
    ) {
      continue
    }
    operations.push({
      type: 'set_run_emphasis',
      paragraphId: item.paragraphId,
      from: item.from,
      to: item.to,
      ...emphasisProperties(item),
    })
  }
  for (const [paragraphId, styleId] of Object.entries(format.paragraphStyles)) {
    if (deleted.has(paragraphId) || omitParagraphIds.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_style',
      paragraphId,
      styleId,
    })
  }
  for (const [paragraphId, numbering] of Object.entries(format.numbering)) {
    if (deleted.has(paragraphId) || omitParagraphIds.has(paragraphId)) continue
    operations.push({
      type: 'set_paragraph_numbering',
      paragraphId,
      numId: numbering.numId,
      ...(numbering.ilvl !== undefined ? { ilvl: numbering.ilvl } : {}),
      ...(numbering.startOverride !== undefined
        ? { startOverride: numbering.startOverride }
        : {}),
    })
  }
  for (const [paragraphId, paragraphFormat] of Object.entries(
    format.paragraphFormats,
  )) {
    if (deleted.has(paragraphId) || omitParagraphIds.has(paragraphId)) continue
    const fields = paragraphFormatFields(paragraphFormat)
    // The contract requires at least one assigned field, so an all-undefined
    // draft (a cleared entry) is a no-op rather than an invalid operation.
    if (Object.keys(fields).length === 0) continue
    operations.push({
      type: 'set_paragraph_format',
      paragraphId,
      ...fields,
    })
  }
  return operations
}
export function mergeEmphasis(
  current: PendingEmphasis[],
  next: PendingEmphasis,
): PendingEmphasis[] {
  const rest =
    next.paragraphId === undefined
      ? current.filter((item) => item.runId !== next.runId)
      : current.filter(
          (item) =>
            !(
              item.paragraphId === next.paragraphId &&
              item.from === next.from &&
              item.to === next.to
            ),
        )
  const previous =
    next.paragraphId === undefined
      ? current.find((item) => item.runId === next.runId)
      : current.find(
          (item) =>
            item.paragraphId === next.paragraphId &&
            item.from === next.from &&
            item.to === next.to,
        )
  // One entry per addressed run or range, and a restated address is the last
  // entry: projection and save both apply entries in order, so the newest
  // answer must sit behind the older one it replaces rather than in front of
  // it. The save plan keys a range slot by its address, which assumes the
  // same single entry.
  return [...rest, { ...previous, ...next }]
}

export function emphasisAddress(
  paragraph: DocumentParagraphWire,
  sliceFrom: number,
  selectionStart: number,
  selectionEnd: number,
  /**
   * The runs whole-run emphasis may address by id. A collapsed caret in a run
   * outside this set (a join's appended run, which the save folds into another
   * run) addresses that run's span in the paragraph instead: a range is the
   * only address paint and save can both carry for text this run id does not
   * name server-side.
   */
  wholeRunIds?: ReadonlySet<string>,
): { runId: string } | { paragraphId: string; from: number; to: number } {
  const from = sliceFrom + Math.min(selectionStart, selectionEnd)
  const to = sliceFrom + Math.max(selectionStart, selectionEnd)
  if (from !== to) {
    // The selection is in the paragraph text this function is given, which
    // must already be the effective string. Snapping here is what save sends,
    // so a range cannot ask the server to cut a surrogate the paint avoided.
    const snapped = snapEmphasisRange(paragraphPlainText(paragraph), from, to)
    return { paragraphId: paragraph.id, ...snapped }
  }
  let cursor = 0
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from >= cursor && from < end) {
      if (!wholeRunIds || wholeRunIds.has(run.id)) return { runId: run.id }
      return { paragraphId: paragraph.id, from: cursor, to: end }
    }
    cursor = end
  }
  const last = paragraph.runs[paragraph.runs.length - 1]
  if (
    last &&
    wholeRunIds &&
    !wholeRunIds.has(last.id) &&
    last.text.length > 0
  ) {
    return {
      paragraphId: paragraph.id,
      from: cursor - last.text.length,
      to: cursor,
    }
  }
  return { runId: last?.id ?? '' }
}
export function toggleEmphasisOnRuns(
  format: FormatDrafts,
  runIds: readonly string[],
  patch: EmphasisPatch,
): FormatDrafts {
  let emphasis = format.emphasis
  for (const runId of runIds) {
    emphasis = mergeEmphasis(emphasis, { runId, ...patch })
  }
  return { ...format, emphasis }
}

export function toggleEmphasisAtAddress(
  format: FormatDrafts,
  address: ReturnType<typeof emphasisAddress>,
  patch: EmphasisPatch,
): FormatDrafts {
  if ('runId' in address) {
    if (!address.runId) return format
    return toggleEmphasisOnRuns(format, [address.runId], patch)
  }
  return {
    ...format,
    emphasis: mergeEmphasis(format.emphasis, {
      paragraphId: address.paragraphId,
      from: address.from,
      to: address.to,
      ...patch,
    }),
  }
}

export function setParagraphStyleDraft(
  format: FormatDrafts,
  paragraphId: string,
  styleId: string | null,
): FormatDrafts {
  return {
    ...format,
    paragraphStyles: { ...format.paragraphStyles, [paragraphId]: styleId },
  }
}

export function indentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const instance = findNumberingInstance(model, current.numId)
  // Clamp to the levels the instance actually defines: a numbering definition
  // can skip a level, and asking for `ilvl + 1` would then name a level the
  // instance does not have.
  const next = nextDefinedLevel(instance?.levels, current.ilvl ?? 0)
  if (next === undefined) return format
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]: { numId: current.numId, ilvl: next },
    },
  }
}

export function outdentList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const instance = findNumberingInstance(model, current.numId)
  // A dangling numbering definition cannot be outdented without emitting an
  // operation the server would reject; leave the paragraph alone instead.
  if (!instance) return format
  const previous = previousDefinedLevel(instance.levels, current.ilvl ?? 0)
  return {
    ...format,
    numbering: {
      ...format.numbering,
      [paragraph.id]:
        previous === undefined
          ? { numId: null }
          : { numId: current.numId, ilvl: previous },
    },
  }
}

/**
 * Restarts the target's list at 1 by pointing it at a numbering instance with a
 * start override. The draft carries the effective instance and level so the
 * save and the paint agree; the writer de-duplicates the override instance.
 */
export function restartList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  if (!findNumberingInstance(model, current.numId)) return format
  const draft: NumberingDraft = {
    numId: current.numId,
    ilvl: current.ilvl ?? 0,
    startOverride: 1,
  }
  return {
    ...format,
    numbering: { ...format.numbering, [paragraph.id]: draft },
  }
}

function nextDefinedLevel(
  levels: ReadonlyArray<{ ilvl: number }> | undefined,
  current: number,
) {
  return (levels ?? [])
    .map((level) => level.ilvl)
    .filter((ilvl) => ilvl > current && ilvl <= 8)
    .sort((left, right) => left - right)[0]
}

function previousDefinedLevel(
  levels: ReadonlyArray<{ ilvl: number }> | undefined,
  current: number,
) {
  return (levels ?? [])
    .map((level) => level.ilvl)
    .filter((ilvl) => ilvl < current && ilvl >= 0)
    .sort((left, right) => right - left)[0]
}

export function continueList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const story = documentStory(model)
  if (!story) return format
  const index = story.paragraphs.findIndex((item) => item.id === paragraph.id)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = story.paragraphs[cursor]
    if (!previous) continue
    const numPr =
      format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles)
    if (!numPr?.numId) continue
    // A previous paragraph may point at a numbering definition this model no
    // longer holds; copying it would emit an operation the server rejects, so
    // keep looking rather than continue from a dangling list.
    if (!findNumberingInstance(model, numPr.numId)) continue
    return {
      ...format,
      numbering: {
        ...format.numbering,
        [paragraph.id]: {
          numId: numPr.numId,
          ...(numPr.ilvl !== undefined ? { ilvl: numPr.ilvl } : {}),
        },
      },
    }
  }
  return format
}
