import {
  type DocumentModelWire,
  type DocumentParagraphWire,
} from '@obiter/contracts'
import {
  editableParagraph,
  editableStoryOf,
  effectiveParagraph,
} from './document-model-text'
import {
  runColour,
  runFlag,
  runFontFamily,
  runFontSize,
  runHighlight,
  runUnderline,
  runVertAlign,
} from './document-run-properties'
import { paragraphNumPr } from './document-page-lists'
import {
  findNumberingInstance,
  paragraphListKind,
  paragraphStartOverride,
  pickNumberingId,
} from './document-list-toggle'
import { paragraphFormatState } from './document-paragraph-format'
import {
  formattedParagraphDraft,
  paragraphStyleOptions,
  projectRangeEmphasis,
} from './document-format-paint'
import type { FormatDrafts } from './document-format-types'
import type { ExtraRuns } from './document-word-edits'

export function selectedParagraph(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return undefined
  return editableParagraph(model, paragraphId)
}
export function runFlagOn(
  xml: string,
  flag: 'bold' | 'italic' | 'underline' | 'strikethrough',
) {
  if (flag === 'underline') return runUnderline(xml) ?? false
  const name = flag === 'strikethrough' ? 'strike' : flag === 'bold' ? 'b' : 'i'
  return runFlag(xml, name) ?? false
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
  flag: 'bold' | 'italic' | 'underline' | 'strikethrough',
) {
  // The covered runs come from the projected effective paragraph, so their
  // XML already carries every pending answer in application order: run-level
  // drafts in the base, then the range drafts. Reading the XML is reading
  // exactly what paint decides; a pending entry consulted out of order could
  // disagree with the slice it is read for.
  return (
    runs.length > 0 &&
    runs.every((run) => runFlagOn(run.preservedXmlFragments.join(''), flag))
  )
}

/**
 * The value every covered run agrees on, or `null` when they disagree or none
 * is covered. A value control (highlight, vertical align) uses this so a mixed
 * selection reads unpressed and one click makes it uniform.
 */
function uniformCoveredValue<T>(
  runs: DocumentParagraphWire['runs'],
  read: (xml: string) => T,
): T | null {
  if (runs.length === 0) return null
  const first = read(runs[0]?.preservedXmlFragments.join('') ?? '')
  return runs.every((run) => read(run.preservedXmlFragments.join('')) === first)
    ? first
    : null
}

// e40-selection-format-state: pressed flags follow the covered runs, not runs[0]
// e42-painted-format-control: cover painted splits, not the unsplit source paragraph
// e70-effective-format-control: cover the effective text the paint path paints,
// not the stored paragraph the drafts have not been applied to
/**
 * The runs a selection covers, across every paragraph it spans. One range per
 * paragraph, in document order; a collapsed range (from === to) is the run the
 * caret sits in, which is how the caret case addresses its formatting.
 *
 * The paragraph is derived exactly as the editor paints it: format drafts
 * applied, then the join's appended runs and text drafts, then pending range
 * emphasis projected over that string. A selection carrying only unsaved
 * characters covers no stored run, so reading the stored paragraph left the
 * control reporting "off" while the screen and the save said "on".
 */
function coveredRuns(
  model: DocumentModelWire,
  ranges: ReadonlyArray<{ paragraphId: string; from: number; to: number }>,
  format: FormatDrafts,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns | undefined,
): DocumentParagraphWire['runs'] {
  return ranges.flatMap((range) => {
    const stored = selectedParagraph(model, range.paragraphId)
    if (!stored) return []
    const painted = formattedParagraphDraft(stored, format)
    const effective = effectiveParagraph(
      painted,
      drafts,
      extraRuns?.[range.paragraphId] ?? [],
    )
    return runsCoveringRange(
      projectRangeEmphasis(effective, format.emphasis),
      range,
    )
  })
}

/** Every distinct paragraph a selection covers, in the order given. */
export function selectedParagraphIds(
  ranges: ReadonlyArray<{ paragraphId: string }>,
): string[] {
  return [...new Set(ranges.map((range) => range.paragraphId))]
}

/** The numbering instance a target names, including its pending draft. */
function numberedInstance(
  model: DocumentModelWire,
  format: FormatDrafts,
  item: DocumentParagraphWire,
) {
  const numPr = format.numbering[item.id] ?? paragraphNumPr(item, model.styles)
  return findNumberingInstance(model, numPr?.numId)
}

export function formatControlState(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  ranges: ReadonlyArray<{ paragraphId: string; from: number; to: number }> = [],
  /**
   * The ranges that carry text to format. A selection of only paragraph
   * breaks covers paragraphs but no code units, and addressing a paragraph
   * mark is not something the edit contract can express, so those ranges are
   * excluded rather than silently formatting a whole run under them.
   */
  emphasisRanges: ReadonlyArray<{
    paragraphId: string
    from: number
    to: number
  }> = ranges,
  /**
   * The text drafts and a join's appended runs. A selection carries offsets
   * in that effective text, so the cover and the flags must read it too.
   */
  drafts?: Record<string, string>,
  extraRuns?: ExtraRuns,
) {
  const stored = selectedParagraph(model, paragraphId)
  const paragraph = stored ? formattedParagraphDraft(stored, format) : undefined
  const covered = coveredRuns(model, emphasisRanges, format, drafts, extraRuns)
  const numPr = paragraph
    ? (format.numbering[paragraph.id] ??
      paragraphNumPr(paragraph, model.styles))
    : undefined
  const story = paragraphId ? editableStoryOf(model, paragraphId) : undefined
  const index =
    story?.paragraphs.findIndex((item) => item.id === paragraphId) ?? -1
  const previous = index > 0 ? story?.paragraphs[index - 1] : undefined
  const previousNum = previous
    ? (format.numbering[previous.id] ?? paragraphNumPr(previous, model.styles))
    : undefined
  const currentInstance = findNumberingInstance(model, numPr?.numId)
  const currentIlvl = numPr?.ilvl ?? 0
  const canIndent = Boolean(
    currentInstance?.levels?.some(
      (level) => level.ilvl > currentIlvl && level.ilvl <= 8,
    ),
  )
  const paragraphIds = selectedParagraphIds(ranges)
  // A multi-paragraph selection whose paragraphs do not all carry one style is
  // a defined mixed state: no chip is pressed and the select does not falsely
  // show one paragraph's style. A pending insert's style lives only in the
  // format drafts until the insert is saved, so the draft is read for it too.
  const paragraphStyleIds = paragraphIds.map((id) =>
    effectiveParagraphStyleId(model, format, id),
  )
  const styleAgrees =
    paragraphStyleIds.length > 0 &&
    paragraphStyleIds.every((value) => value === paragraphStyleIds[0])
  const paragraphStyleId = styleAgrees ? (paragraphStyleIds[0] ?? '') : ''
  const paragraphStyleMixed = paragraphIds.length > 1 && !styleAgrees
  const targetParagraphs = paragraphIds.flatMap((id) => {
    const item = selectedParagraph(model, id)
    return item ? [item] : []
  })
  // Restart acts on every stored target paragraph, not just the caret's, so
  // the control is available when any target names a valid numbering instance.
  const numberedTargets = targetParagraphs.filter((item) =>
    Boolean(numberedInstance(model, format, item)),
  )
  const canRestart = numberedTargets.length > 0
  // Pressed only when every numbered target carries an override, so a mixed
  // selection reads unpressed and one click makes the whole selection restart.
  const listRestarted =
    numberedTargets.length > 0 &&
    numberedTargets.every((item) => {
      const override = paragraphStartOverride(model, format, item)
      return override !== undefined && override !== null
    })
  const paragraphFormat = paragraphFormatState(model, format, paragraphIds)
  return {
    paragraph,
    paragraphIds,
    // A pending insert is not part of the stored story, so its style lives only
    // in the format drafts until the insert is saved. Report it so the style
    // control shows the chosen style instead of "No direct style".
    paragraphStyleId,
    paragraphStyleMixed,
    paragraphStyles: paragraphStyleOptions(model),
    alignment: paragraphFormat.alignment,
    lineSpacing: paragraphFormat.lineSpacing,
    indentKind: paragraphFormat.indent,
    bold: flagOnCoveredRuns(covered, 'bold'),
    italic: flagOnCoveredRuns(covered, 'italic'),
    underline: flagOnCoveredRuns(covered, 'underline'),
    strikethrough: flagOnCoveredRuns(covered, 'strikethrough'),
    // A font control reads the value every covered run agrees on, like
    // highlight and vertical align: a mixed selection reads unset so one
    // choice makes it uniform. Null means no direct value or a disagreement.
    fontFamily: uniformCoveredValue(covered, runFontFamily),
    fontSize: uniformCoveredValue(covered, runFontSize),
    colour: uniformCoveredValue(covered, runColour),
    highlight: uniformCoveredValue(covered, runHighlight),
    vertAlign: uniformCoveredValue(
      covered,
      (xml) => runVertAlign(xml) ?? 'baseline',
    ),
    canIndent,
    canOutdent: Boolean(currentInstance),
    canContinue: Boolean(findNumberingInstance(model, previousNum?.numId)),
    canRestart,
    listRestarted,
    listKind: paragraphListKind(model, format, paragraph),
    canApplyBullet: Boolean(pickNumberingId(model, 'bullet')),
    canApplyNumber: Boolean(pickNumberingId(model, 'number')),
    canApplyMultilevel: Boolean(pickNumberingId(model, 'multilevel')),
  }
}

/** The style a paragraph effectively carries, including a pending style draft. */
function effectiveParagraphStyleId(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string,
): string {
  const draft = format.paragraphStyles[paragraphId]
  if (draft !== undefined) return draft ?? ''
  return selectedParagraph(model, paragraphId)?.styleId ?? ''
}
