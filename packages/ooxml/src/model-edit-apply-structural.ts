import type { EditApplyContext } from './model-edit-apply'
import type { PlannedOperation } from './model-edit-validation'
import { OoxmlError } from './model'
import { insertSectionBreak } from './section-edits'
import { editTableStructure } from './table-structure-edits'
import { insertTable } from './table-edits'
import { insertImage, setImageSize } from './image-edits'
import { setHyperlink } from './hyperlink-edits'
import { insertCrossReference } from './cross-reference-edits'
import { markDefinedTerm } from './defined-term-edits'
import { deleteFootnote, insertFootnote } from './footnote-edits'
import { insertPageNumber } from './page-number-edits'
import { insertTableOfContents } from './table-of-contents-edits'
import { insertTableOfAuthorities } from './table-of-authorities-edits'
import { updateTableOfAuthorities } from './table-of-authorities-update'

export function applyStructuralOperation(
  context: EditApplyContext,
  operation: PlannedOperation,
  operationIndex: number,
  deletedLater: boolean,
) {
  const { document, mainStory, trackedWriter, lineage, deletedIds, state } =
    context
  if (operation.type === 'insert_section_break') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) insertSectionBreak(document, operation.paragraph)
  } else if (
    operation.type === 'insert_table_row' ||
    operation.type === 'insert_table_column' ||
    operation.type === 'delete_table_row' ||
    operation.type === 'delete_table_column' ||
    operation.type === 'delete_table'
  ) {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    editTableStructure(document, operation.paragraph, operation)
  } else if (operation.type === 'insert_table') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.tableCounts.get(key) ?? 0
      const inserted = insertTable(
        document,
        mainStory,
        operation.paragraph,
        operation.rows,
        operation.columns,
        state.postAnchorTails.get(key),
        occurrence,
        lineage ? { recorder: lineage, operationIndex } : undefined,
        operation.cellEdits,
      )
      state.postAnchorTails.set(key, inserted.lastCell)
      state.postAnchorCounts.set(
        key,
        (state.postAnchorCounts.get(key) ?? 0) + inserted.appended,
      )
      if (inserted.trailingWire) {
        const trailing = inserted.trailingWire
        const from = mainStory.paragraphs.findIndex(
          (paragraph) => paragraph.id === trailing.id,
        )
        const wire = from === -1 ? trailing : mainStory.paragraphs[from]
        if (from !== -1) mainStory.paragraphs.splice(from, 1)
        const at = mainStory.paragraphs.indexOf(inserted.lastCell)
        mainStory.paragraphs.splice(at + 1, 0, wire ?? trailing)
      }
      state.tableCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'insert_image') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.imageCounts.get(key) ?? 0
      insertImage(document, operation.paragraph, operation, occurrence, lineage)
      state.imageCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'set_image_size') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    const key = operation.run.wire.id
    const occurrence = state.imageSizeCounts.get(key) ?? 0
    setImageSize(
      document,
      operation.paragraph,
      operation.run,
      operation,
      occurrence,
    )
    state.imageSizeCounts.set(key, occurrence + 1)
  } else if (operation.type === 'set_hyperlink') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      setHyperlink(
        document,
        operation.paragraph,
        operation,
        occurrence,
        lineage,
      )
      state.structureCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'insert_cross_reference') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      insertCrossReference(
        document,
        operation.paragraph,
        operation.targetParagraph,
        operation.offset,
        occurrence,
        lineage,
      )
      state.structureCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'mark_defined_term') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      markDefinedTerm(
        document,
        operation.paragraph,
        operation.from,
        operation.to,
        occurrence,
        lineage,
      )
      state.structureCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'insert_footnote') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      insertFootnote(
        document,
        operation.paragraph,
        operation.offset,
        operation.text,
        occurrence,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
      state.structureCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'delete_footnote') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater)
      deleteFootnote(document, operation.run, operation.paragraph)
  } else if (operation.type === 'insert_page_number') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      insertPageNumber(
        document,
        operation.paragraph,
        operation.offset,
        occurrence,
        lineage,
      )
      state.structureCounts.set(key, occurrence + 1)
    }
  } else if (operation.type === 'insert_table_of_contents') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      const inserted = insertTableOfContents(
        document,
        mainStory,
        operation.paragraph,
        operation.offset,
        occurrence,
        deletedIds,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
      state.structureCounts.set(key, occurrence + 1)
      state.postAnchorTails.set(key, inserted.lastWire)
      state.postAnchorCounts.set(
        key,
        (state.postAnchorCounts.get(key) ?? 0) + inserted.appended,
      )
    }
  } else if (operation.type === 'insert_table_of_authorities') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.structureCounts.get(key) ?? 0
      const inserted = insertTableOfAuthorities(
        document,
        mainStory,
        operation.paragraph,
        operation.offset,
        occurrence,
        deletedIds,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
      state.structureCounts.set(key, occurrence + 1)
      state.postAnchorTails.set(key, inserted.lastWire)
      state.postAnchorCounts.set(
        key,
        (state.postAnchorCounts.get(key) ?? 0) + inserted.appended,
      )
    }
  } else if (operation.type === 'update_table_of_authorities') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      updateTableOfAuthorities(
        document,
        mainStory,
        operation.paragraph,
        deletedIds,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
    }
  } else {
    throw new OoxmlError('invalid-document-edit')
  }
}
