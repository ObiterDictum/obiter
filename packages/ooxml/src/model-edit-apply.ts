import { applyStructuralOperation } from './model-edit-apply-structural'
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
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import {
  isSectionOperation,
  runEmphasisFields,
  storyOfParagraph,
} from './model-edit-plan'
import type { PlannedOperation } from './model-edit-validation'
import { deleteParagraph, insertParagraphAfter } from './model-paragraph-edits'
import { setParagraphNumbering } from './numbering-edits'
import { setParagraphFormat, setRunEmphasis } from './model-property-edits'
import { insertPageBreak, setSectionProperties } from './section-edits'
import type { RunEmphasisRange } from './model-run-emphasis'
import { setParagraphStyle, setRunStyle } from './model-style-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'
import type { createTrackedEditWriter } from './tracked-edits'

type TrackedEditWriter = ReturnType<typeof createTrackedEditWriter>

export type EditApplyState = {
  insertionCounts: Map<string, number>
  postAnchorCounts: Map<string, number>
  postAnchorTails: Map<string, DocumentParagraphWire>
  tableCounts: Map<string, number>
  imageCounts: Map<string, number>
  imageSizeCounts: Map<string, number>
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
    imageSizeCounts: new Map(),
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
  const { document, trackedWriter, lineage, deletedIds, state } = context
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
  } else {
    applyStructuralOperation(context, operation, operationIndex, deletedLater)
  }
}
