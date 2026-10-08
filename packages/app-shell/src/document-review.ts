import type { DocumentChangeWire, DocumentModelWire } from '@obiter/contracts'
import { editableParagraphs } from './document-model-text'

/**
 * The paragraphs a rejection may also remove: empty tracked-insert shells.
 * A tracked paragraph insertion wraps all its content in `w:ins`, so the
 * paragraph parses with no visible runs; rejecting the insert without
 * removing the shell would strand an empty paragraph. The decision route
 * removes them in the same atomic call — but only shells whose every pending
 * change is one of the rejected insertions are safe to name: an undecided
 * change inside the shell would otherwise vanish without a decision.
 */
export function rejectedShellParagraphIds(
  model: DocumentModelWire,
  changes: readonly DocumentChangeWire[],
  rejectedIds: ReadonlySet<string>,
) {
  return editableParagraphs(model)
    .filter((paragraph) => {
      if (paragraph.runs.length > 0) return false
      const inside = changes.filter(
        (change) => change.paragraphId === paragraph.id,
      )
      return (
        inside.length > 0 &&
        inside.every(
          (change) => change.kind === 'insert' && rejectedIds.has(change.id),
        )
      )
    })
    .map((paragraph) => paragraph.id)
}
