import type { DocumentModelWire } from '@obiter/contracts'
import type { BreakDraft } from './document-edits'
import { documentStory, editableParagraph } from './document-model-text'

type SetBreaks = (update: (current: BreakDraft[]) => BreakDraft[]) => void

export function documentBreakToolbar({
  paragraphId,
  model,
  offset,
  selectionActive,
  trackChanges,
  setBreaks,
}: {
  paragraphId: string | null
  model: DocumentModelWire | undefined
  offset: number | null
  selectionActive: boolean
  trackChanges: boolean
  setBreaks: SetBreaks
}) {
  const paragraphExists = Boolean(
    model &&
    paragraphId &&
    documentStory(model)?.paragraphs.some((item) => item.id === paragraphId),
  )
  const breakUnavailable = trackChanges
    ? 'Breaks are not recorded as a tracked change'
    : selectionActive
      ? 'Collapse the selection to insert a break'
      : !paragraphId
        ? 'Place the cursor in a paragraph to insert a break'
        : !paragraphExists
          ? model && editableParagraph(model, paragraphId)
            ? 'Only the document body can hold this insertion'
            : 'Save the new paragraph before adding a break'
          : offset == null
            ? 'Place the cursor in the paragraph text to insert a break'
            : undefined
  const add = (kind: BreakDraft['kind']) => {
    if (breakUnavailable || !paragraphId || offset == null) return
    setBreaks((current) =>
      current.some(
        (item) =>
          item.paragraphId === paragraphId &&
          item.kind === kind &&
          (kind === 'section' || item.offset === offset),
      )
        ? current
        : [...current, { id: crypto.randomUUID(), paragraphId, offset, kind }],
    )
  }
  return {
    breakUnavailable,
    onPageBreak: () => add('page'),
    onSectionBreak: () => add('section'),
  }
}
