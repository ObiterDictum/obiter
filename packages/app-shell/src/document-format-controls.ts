import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { paragraphNumPr } from './document-page-lists'
import { paragraphListKind, pickNumberingId } from './document-list-toggle'
import {
  formattedModel,
  paragraphStyleOptions,
} from './document-format-paint'
import type { FormatDrafts, PendingEmphasis } from './document-format-types'

export function selectedParagraph(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return undefined
  return documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
}
export function runFlagOn(
  xml: string,
  pending: PendingEmphasis | undefined,
  flag: 'bold' | 'italic' | 'underline',
) {
  if (pending?.[flag] === true) return true
  if (pending?.[flag] === false || pending?.[flag] === null) return false
  if (flag === 'underline') {
    return /<w:u\b(?![^>]*w:val="none")/i.test(xml)
  }
  const name = flag === 'bold' ? 'b' : 'i'
  return new RegExp(`<w:${name}\\b(?![^>]*w:val="0")`, 'i').test(xml)
}

function runsCoveringRange(
  paragraph: DocumentParagraphWire | undefined,
  selection: { from: number; to: number } | undefined,
) {
  if (!paragraph) return []
  const from = Math.min(selection?.from ?? 0, selection?.to ?? 0)
  const to = Math.max(selection?.from ?? 0, selection?.to ?? 0)
  let cursor = 0
  const covered: DocumentParagraphWire['runs'] = []
  for (const run of paragraph.runs) {
    const end = cursor + run.text.length
    if (from === to) {
      if (from >= cursor && from < end) return [run]
    } else if (Math.max(from, cursor) < Math.min(to, end)) {
      covered.push(run)
    }
    cursor = end
  }
  if (from === to) {
    const last = paragraph.runs[paragraph.runs.length - 1]
    return last ? [last] : []
  }
  return covered
}

function flagOnCoveredRuns(
  runs: DocumentParagraphWire['runs'],
  format: FormatDrafts,
  flag: 'bold' | 'italic' | 'underline',
) {
  return (
    runs.length > 0 &&
    runs.every((run) =>
      runFlagOn(
        run.preservedXmlFragments.join(''),
        format.emphasis.find((item) => item.runId === run.id),
        flag,
      ),
    )
  )
}

// e40-selection-format-state: pressed flags follow the covered runs, not runs[0]
// e42-painted-format-control: cover painted splits, not the unsplit source paragraph
/**
 * The runs a selection covers, across every paragraph it spans. One range per
 * paragraph, in document order; a collapsed range (from === to) is the run the
 * caret sits in, which is how the caret case addresses its formatting.
 */
function coveredRuns(
  view: DocumentModelWire,
  ranges: ReadonlyArray<{ paragraphId: string; from: number; to: number }>,
): DocumentParagraphWire['runs'] {
  return ranges.flatMap((range) =>
    runsCoveringRange(selectedParagraph(view, range.paragraphId), range),
  )
}

/** Every distinct paragraph a selection covers, in the order given. */
export function selectedParagraphIds(
  ranges: ReadonlyArray<{ paragraphId: string }>,
): string[] {
  return [...new Set(ranges.map((range) => range.paragraphId))]
}

export function formatControlState(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  ranges: ReadonlyArray<{ paragraphId: string; from: number; to: number }> = [],
) {
  const view = formattedModel(model, format)
  const paragraph = selectedParagraph(view, paragraphId)
  const covered = coveredRuns(view, ranges)
  const numPr = paragraph
    ? (format.numbering[paragraph.id] ?? paragraphNumPr(paragraph, view.styles))
    : undefined
  const story = documentStory(view)
  const index =
    story?.paragraphs.findIndex((item) => item.id === paragraphId) ?? -1
  const previous = index > 0 ? story?.paragraphs[index - 1] : undefined
  const previousNum = previous
    ? (format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles))
    : undefined
  const nextIlvl = (numPr?.ilvl ?? 0) + 1
  const canIndent = Boolean(
    numPr?.numId &&
    model.numbering
      .find((item) => item.numberingId === numPr.numId)
      ?.levels?.some((level) => level.ilvl === nextIlvl),
  )
  return {
    paragraph,
    paragraphIds: selectedParagraphIds(ranges),
    // A pending insert is not part of the stored story, so its style lives only
    // in the format drafts until the insert is saved. Report it so the style
    // control shows the chosen style instead of "No direct style".
    paragraphStyleId:
      paragraph?.styleId ??
      (paragraphId ? (format.paragraphStyles[paragraphId] ?? '') : ''),
    paragraphStyles: paragraphStyleOptions(model),
    bold: flagOnCoveredRuns(covered, format, 'bold'),
    italic: flagOnCoveredRuns(covered, format, 'italic'),
    underline: flagOnCoveredRuns(covered, format, 'underline'),
    canIndent,
    canOutdent: Boolean(numPr?.numId),
    canContinue: Boolean(previousNum?.numId),
    listKind: paragraphListKind(model, format, paragraph),
    canApplyBullet: Boolean(pickNumberingId(model, 'bullet')),
    canApplyNumber: Boolean(pickNumberingId(model, 'number')),
    canApplyMultilevel: Boolean(pickNumberingId(model, 'multilevel')),
  }
}
