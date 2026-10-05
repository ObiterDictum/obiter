import type { DocumentModelWire } from '@obiter/contracts'
import type { BreakDraft } from './document-edits'
import { documentStory } from './document-model-text'

type SetBreaks = (update: (current: BreakDraft[]) => BreakDraft[]) => void

/**
 * The Insert ribbon's break controls. A break is anchored to a collapsed caret
 * in a stored paragraph. A selection has no single insertion point, a pending
 * insert has no server paragraph yet, and tracked changes cannot record a break,
 * so each is an honest disabled reason rather than a silent no-op.
 *
 * Inserting a break at a caret that already holds one of the same kind is a
 * no-op. Two page breaks at the identical paragraph offset share the save's
 * overlay key — only one is written — while the paginator would lay both out,
 * a paint/save divergence. Deduplicating here keeps the draft state canonical
 * (one break per paragraph, offset and kind), so the save plan and the paint
 * read the same single break. Different kinds at one offset stay distinct: a
 * page break and a section break there are two different structures.
 */
export function documentBreakToolbar({
  paragraphId,
  model,
  offset,
  selectionActive,
  trackChanges,
  setBreaks,
}: {
  paragraphId: string | null
  /** The painted model, to tell a stored paragraph from a pending insert. */
  model: DocumentModelWire | undefined
  offset: number
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
          ? 'Save the new paragraph before adding a break'
          : undefined
  const add = (kind: BreakDraft['kind']) => {
    if (breakUnavailable || !paragraphId) return
    setBreaks((current) =>
      current.some(
        (item) =>
          item.paragraphId === paragraphId &&
          item.offset === offset &&
          item.kind === kind,
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
