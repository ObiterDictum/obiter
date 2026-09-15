import type { DocumentModelWire } from '@obiter/contracts'
import { toggleParagraphList, type ListKind } from './document-list-toggle'
import type { FormatDrafts } from './document-format-types'
import {
  continueList,
  emphasisAddress,
  indentList,
  outdentList,
  setParagraphStyleDraft,
  toggleEmphasisAtAddress,
} from './document-format-edits'
import { formatControlState } from './document-format-paint'

export function documentFormatToolbar(
  model: DocumentModelWire,
  format: FormatDrafts,
  paragraphId: string | null,
  setFormat: (update: (current: FormatDrafts) => FormatDrafts) => void,
  selection?: { from: number; to: number },
  trackChanges = false,
) {
  const controls = formatControlState(model, format, paragraphId, selection)
  const paragraph = controls.paragraph
  const address = paragraph
    ? emphasisAddress(
        paragraph,
        0,
        selection?.from ?? 0,
        selection?.to ?? selection?.from ?? 0,
      )
    : undefined
  const trackedRange =
    trackChanges && address !== undefined && 'paragraphId' in address
  const toggle = (flag: 'bold' | 'italic' | 'underline', value: boolean) => {
    if (!address || trackedRange) return
    setFormat((current) =>
      toggleEmphasisAtAddress(current, address, flag, value),
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
      if (!paragraphId) return
      setFormat((current) =>
        setParagraphStyleDraft(current, paragraphId, styleId),
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
    onIndent: () => {
      if (!paragraph) return
      setFormat((current) => indentList(current, model, paragraph))
    },
    onOutdent: () => {
      if (!paragraph) return
      setFormat((current) => outdentList(current, model, paragraph))
    },
    onContinueList: () => {
      if (!paragraph) return
      setFormat((current) => continueList(current, model, paragraph))
    },
    onToggleList: (kind: ListKind) => {
      if (!paragraph) return
      setFormat((current) =>
        toggleParagraphList(current, model, paragraph, kind),
      )
    },
  }
}
