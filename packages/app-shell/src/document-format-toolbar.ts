import type { DocumentModelWire } from '@obiter/contracts'
import { toggleParagraphList, type ListKind } from './document-list-toggle'
import {
  continueList,
  emphasisAddress,
  indentList,
  outdentList,
  setParagraphStyleDraft,
  toggleEmphasisAtAddress,
} from './document-format-edits'
import {
  formatControlState,
  selectedParagraph,
} from './document-format-controls'
import type { FormatDrafts } from './document-format-types'

/**
 * The selection a formatting command acts on: one range per paragraph, in
 * document order. A collapsed range addresses the run the caret sits in, so a
 * caret click, a native within-paragraph selection and a selection spanning
 * paragraphs all go through the same path.
 */
export type FormatRanges = ReadonlyArray<{
  paragraphId: string
  from: number
  to: number
}>

export function documentFormatToolbar(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  setFormat: (update: (current: FormatDrafts) => FormatDrafts) => void,
  ranges: FormatRanges = [],
  trackChanges = false,
) {
  const controls = formatControlState(model, format, paragraphId, ranges)
  const paragraph = controls.paragraph
  // A tracked change records a single run, so partial formatting of a range is
  // not representable yet; fail closed rather than dropping the tracking.
  const trackedRange =
    trackChanges && ranges.some((range) => range.from !== range.to)
  const toggle = (flag: 'bold' | 'italic' | 'underline', value: boolean) => {
    if (trackedRange || ranges.length === 0) return
    setFormat((current) => {
      let next = current
      for (const range of ranges) {
        const target = selectedParagraph(model, range.paragraphId)
        if (!target) continue
        next = toggleEmphasisAtAddress(
          next,
          emphasisAddress(target, 0, range.from, range.to),
          flag,
          value,
        )
      }
      return next
    })
  }
  const forEachParagraph = (
    apply: (current: FormatDrafts, paragraphId: string) => FormatDrafts,
  ) => {
    setFormat((current) =>
      controls.paragraphIds.reduce((next, id) => apply(next, id), current),
    )
  }
  return {
    ...(trackedRange
      ? {
          emphasisUnavailable:
            'Partial formatting is not yet recorded as a tracked change',
        }
      : {}),
    paragraphStyleId: controls.paragraphStyleId,
    paragraphStyles: controls.paragraphStyles,
    bold: controls.bold,
    italic: controls.italic,
    underline: controls.underline,
    canIndent: controls.canIndent,
    canOutdent: controls.canOutdent,
    canContinue: controls.canContinue,
    listKind: controls.listKind,
    canApplyBullet: controls.canApplyBullet,
    canApplyNumber: controls.canApplyNumber,
    canApplyMultilevel: controls.canApplyMultilevel,
    onParagraphStyle: (styleId: string | null) => {
      if (controls.paragraphIds.length === 0) return
      forEachParagraph((current, id) =>
        setParagraphStyleDraft(current, id, styleId),
      )
    },
    onToggleBold: () => {
      toggle('bold', !controls.bold)
    },
    onToggleItalic: () => {
      toggle('italic', !controls.italic)
    },
    onToggleUnderline: () => {
      toggle('underline', !controls.underline)
    },
    onIndent: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? indentList(current, model, target) : current
      }),
    onOutdent: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? outdentList(current, model, target) : current
      }),
    onContinueList: () =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? continueList(current, model, target) : current
      }),
    onToggleList: (kind: ListKind) =>
      forEachParagraph((current, id) => {
        const target = selectedParagraph(model, id)
        return target ? toggleParagraphList(current, model, target, kind) : current
      }),
  }
}
