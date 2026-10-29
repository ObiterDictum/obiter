import type { DocumentChangeWire, DocumentModelWire } from '@obiter/contracts'
import { editableParagraphs } from './document-model-text'

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
