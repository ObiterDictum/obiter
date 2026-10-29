import {
  insertParagraphRuns,
  type DocumentParagraphWire,
  type DocumentStoryWire,
} from '@obiter/contracts'
import {
  recordReplacedRun,
  seedRunOrigins,
  touchParagraph,
  type LineageRecorder,
} from './document-lineage'
import { insertCrossReference } from './cross-reference-edits'
import { markDefinedTerm } from './defined-term-edits'
import { insertFootnote } from './footnote-edits'
import { setHyperlink } from './hyperlink-edits'
import { insertImage } from './image-edits'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import {
  isSectionOperation,
  runEmphasisFields,
  storyOfParagraph,
} from './model-edit-plan'
import type { PlannedOperation } from './model-edit-validation'
import { deleteParagraph, insertParagraphAfter } from './model-paragraph-edits'
import { setParagraphNumbering } from './numbering-edits'
import { insertPageNumber } from './page-number-edits'
import { setParagraphFormat, setRunEmphasis } from './model-property-edits'
import {
  insertPageBreak,
  insertSectionBreak,
  setSectionProperties,
} from './section-edits'
import type { RunEmphasisRange } from './model-run-emphasis'
import { setParagraphStyle, setRunStyle } from './model-style-edits'
import { insertTable } from './table-edits'
import { insertTableOfAuthorities } from './table-of-authorities-edits'
import { updateTableOfAuthorities } from './table-of-authorities-update'
import { insertTableOfContents } from './table-of-contents-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'
import type { createTrackedEditWriter } from './tracked-edits'

type TrackedEditWriter = ReturnType<typeof createTrackedEditWriter>

export type EditApplyState = {
  insertionCounts: Map<string, number>
  postAnchorCounts: Map<string, number>
  postAnchorTails: Map<string, DocumentParagraphWire>
  tableCounts: Map<string, number>
  imageCounts: Map<string, number>
  structureCounts: Map<string, number>
  breakOffsets: Map<string, number[]>
  rangeEmphasis: Map<ParagraphAnchor, RunEmphasisRange[]>
  trackedRangeEmphasis: Map<
    ParagraphAnchor,
    { ranges: RunEmphasisRange[]; operationIndex: number }
  >
}

export function newEditApplyState(): EditApplyState {
  return {
    insertionCounts: new Map(),
    postAnchorCounts: new Map(),
    postAnchorTails: new Map(),
    tableCounts: new Map(),
    imageCounts: new Map(),
    structureCounts: new Map(),
    breakOffsets: new Map(),
    rangeEmphasis: new Map(),
    trackedRangeEmphasis: new Map(),
  }
}

export type EditApplyContext = {
  document: OoxmlDocument
  mainStory: DocumentStoryWire
  trackedWriter?: TrackedEditWriter
  lineage?: LineageRecorder
  deletedIds: ReadonlySet<string>
  state: EditApplyState
}

export function applyPlannedOperation(
  context: EditApplyContext,
  operation: PlannedOperation,
  operationIndex: number,
) {
  const { document, mainStory, trackedWriter, lineage, deletedIds, state } =
    context
  const paragraph = 'paragraph' in operation ? operation.paragraph : undefined
  const deletedLater = paragraph ? deletedIds.has(paragraph.wire.id) : false
  if (lineage && paragraph && !isSectionOperation(operation)) {
    touchParagraph(lineage, paragraph.wire, operationIndex)
  }
  if (operation.type === 'replace_run_text') {
    if (deletedLater) return
    if (lineage) seedRunOrigins(lineage, operation.run.wire)
    if (trackedWriter) {
      trackedWriter.replaceRunText(operation.run, operation.text)
    } else if (
      !replaceTextRunAtAnchor(document, operation.run, operation.text)
    ) {
      throw new OoxmlError('model-node-not-editable')
    }
    if (lineage) recordReplacedRun(lineage, operation.run.wire)
  } else if (operation.type === 'set_run_style') {
    if (!deletedLater) {
      if (trackedWriter) {
        trackedWriter.setRunStyle(operation.run, operation.styleId)
      } else {
        setRunStyle(document, operation.run, operation.styleId)
      }
    }
  } else if (operation.type === 'set_paragraph_style') {
    if (!deletedLater) {
      if (trackedWriter) {
        trackedWriter.setParagraphStyle(operation.paragraph, operation.styleId)
      } else {
        setParagraphStyle(document, operation.paragraph, operation.styleId)
      }
    }
  } else if (operation.type === 'set_run_emphasis') {
    if (!deletedLater) {
      if (operation.run) {
        if (trackedWriter) {
          trackedWriter.setRunEmphasis(operation.run, operation)
        } else {
          setRunEmphasis(document, operation.run, operation)
        }
      } else if (
        operation.paragraphId !== undefined &&
        operation.from !== undefined &&
        operation.to !== undefined
      ) {
        if (trackedWriter) {
          const entry = state.trackedRangeEmphasis.get(operation.paragraph)
          const range = {
            from: operation.from,
            to: operation.to,
            ...runEmphasisFields(operation),
          }
          if (entry) {
            entry.ranges.push(range)
          } else {
            state.trackedRangeEmphasis.set(operation.paragraph, {
              ranges: [range],
              operationIndex,
            })
          }
        } else {
          const ranges = state.rangeEmphasis.get(operation.paragraph) ?? []
          ranges.push({
            from: operation.from,
            to: operation.to,
            ...runEmphasisFields(operation),
          })
          state.rangeEmphasis.set(operation.paragraph, ranges)
        }
      } else {
        throw new OoxmlError('invalid-document-edit')
      }
    }
  } else if (operation.type === 'set_paragraph_numbering') {
    if (!deletedLater) {
      if (trackedWriter) {
        trackedWriter.setParagraphNumbering(operation.paragraph, operation)
      } else {
        setParagraphNumbering(document, operation.paragraph, operation)
      }
    }
  } else if (operation.type === 'set_paragraph_format') {
    if (!deletedLater) {
      if (trackedWriter) {
        trackedWriter.setParagraphFormat(operation.paragraph, operation)
      } else {
        setParagraphFormat(document, operation.paragraph, operation)
      }
    }
  } else if (
    operation.type === 'insert_paragraph_after' ||
    operation.type === 'insert_paragraph_before'
  ) {
    const position =
      operation.type === 'insert_paragraph_before' ? 'before' : 'after'
    const anchorStory = storyOfParagraph(document, operation.paragraph)
    if (!anchorStory) throw new OoxmlError('model-node-not-editable')
    if (trackedWriter) {
      const count = state.insertionCounts.get(operation.paragraphId) ?? 0
      trackedWriter.insertParagraphAfter(
        anchorStory,
        operation.paragraph,
        insertParagraphRuns(operation),
        operation.styleId,
        count,
        operation,
        lineage
          ? {
              recorder: lineage,
              operationIndex,
              ...(operation.intentId ? { intentId: operation.intentId } : {}),
            }
          : undefined,
        position,
      )
      state.insertionCounts.set(operation.paragraphId, count + 1)
    } else {
      const count =
        position === 'after'
          ? (state.postAnchorCounts.get(operation.paragraphId) ?? 0)
          : (state.insertionCounts.get(operation.paragraphId) ?? 0)
      const inserted = insertParagraphAfter(
        document,
        anchorStory,
        operation.paragraph,
        insertParagraphRuns(operation),
        operation.styleId,
        count,
        { prefix: 'w', paragraphFormat: operation, position },
        lineage
          ? {
              recorder: lineage,
              operationIndex,
              ...(operation.intentId ? { intentId: operation.intentId } : {}),
            }
          : undefined,
      )
      if (position === 'after') {
        state.postAnchorCounts.set(operation.paragraphId, count + 1)
        state.postAnchorTails.set(operation.paragraphId, inserted)
      } else {
        state.insertionCounts.set(operation.paragraphId, count + 1)
      }
    }
  } else if (operation.type === 'delete_paragraph') {
    if (trackedWriter) {
      trackedWriter.deleteParagraph(
        operation.paragraph,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
    } else {
      const anchorStory = storyOfParagraph(document, operation.paragraph)
      if (!anchorStory) throw new OoxmlError('model-node-not-editable')
      deleteParagraph(
        document,
        anchorStory,
        operation.paragraph,
        lineage ? { recorder: lineage, operationIndex } : undefined,
      )
    }
  } else if (operation.type === 'set_section_properties') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    setSectionProperties(document, operation)
  } else if (operation.type === 'insert_break') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      insertPageBreak(
        document,
        operation.paragraph,
        operation.offset,
        state.breakOffsets,
      )
    }
  } else if (operation.type === 'insert_section_break') {
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) insertSectionBreak(document, operation.paragraph)
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
