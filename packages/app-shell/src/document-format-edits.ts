import type {
  DocumentEditOperation,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  editableParagraphs,
  editableStoryOf,
  paragraphPlainText,
} from './document-model-text'
import { snapEmphasisRange } from './document-format-paint'
import { paragraphFormatFields } from './document-paragraph-format'
import { paragraphNumPr } from './document-page-lists'
import { sectionDraftFields } from './document-section-format'
import {
  findNumberingInstance,
  findRestartInstance,
} from './document-list-toggle'
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
  omitParagraphIds: ReadonlySet<string> = new Set(),
): DocumentEditOperation[] {
  const deleted = new Set(deletedParagraphIds)
  const deletedRuns = new Set(
    editableParagraphs(model)
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
    if (Object.keys(fields).length === 0) continue
    operations.push({
      type: 'set_paragraph_format',
      paragraphId,
      ...fields,
    })
  }
  const section = sectionDraftFields(format.section ?? {})
  if (section) {
    operations.push({ type: 'set_section_properties', ...section })
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
  return [...rest, { ...previous, ...next }]
}

export function emphasisAddress(
  paragraph: DocumentParagraphWire,
  sliceFrom: number,
  selectionStart: number,
  selectionEnd: number,
  wholeRunIds?: ReadonlySet<string>,
): { runId: string } | { paragraphId: string; from: number; to: number } {
  const from = sliceFrom + Math.min(selectionStart, selectionEnd)
  const to = sliceFrom + Math.max(selectionStart, selectionEnd)
  if (from !== to) {
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

export function restartList(
  format: FormatDrafts,
  model: DocumentModelWire,
  paragraph: DocumentParagraphWire,
): FormatDrafts {
  const current =
    format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, model.styles)
  if (!current?.numId) return format
  const source = findNumberingInstance(model, current.numId)
  if (!source) return format
  const ilvl = current.ilvl ?? 0
  const matching = findRestartInstance(model, source, ilvl, 1)
  const draft: NumberingDraft = {
    numId: matching?.numberingId ?? current.numId,
    ilvl,
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
  const story = editableStoryOf(model, paragraph.id)
  if (!story) return format
  const index = story.paragraphs.findIndex((item) => item.id === paragraph.id)
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = story.paragraphs[cursor]
    if (!previous) continue
    const numPr =
      format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles)
    if (!numPr?.numId) continue
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
