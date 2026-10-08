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
import { insertTableOfContents } from './table-of-contents-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'
import type { createTrackedEditWriter } from './tracked-edits'

export type TrackedEditWriter = ReturnType<typeof createTrackedEditWriter>

// Per-batch mutable state shared across the operations of one edit batch.
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
    // Post-anchor insertions chain in operation order at the same source
    // offset: overlay keys emit in insertion order, so the wire model must
    // splice each new paragraph or table after the wire the previous
    // insertion appended. `postAnchorCounts` counts every wire appended
    // after an anchor — paragraph inserts, cell wires, separators and a
    // table's trailing paragraph — and `postAnchorTails` names the last of
    // them, so a paragraph insert after a table and a table after a
    // paragraph insert both land where the serialised output puts them.
    insertionCounts: new Map(),
    postAnchorCounts: new Map(),
    postAnchorTails: new Map(),
    // Per-anchor occurrence counters keep each table's overlay key and
    // separator decision distinct and each image's splice key unique.
    tableCounts: new Map(),
    imageCounts: new Map(),
    structureCounts: new Map(),
    // Page-break offsets are accumulated per run, run-local, so multiple
    // breaks on one run materialise as a single replacement instead of
    // overlapping `:text:` writes.
    breakOffsets: new Map(),
    // Range emphasis is collected per paragraph and applied after the loop.
    // Every operation in a batch addresses the same paragraph text, so the
    // boundaries from all of them must form one split per run; applying them
    // one at a time would let each split overwrite the previous run
    // structure.
    rangeEmphasis: new Map(),
    // The tracked form collects the ranges with the index of the operation
    // that produced them, so the changes a deferred split creates still
    // record against the right batch entry.
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
          // The tracked split marks every covered piece's properties with its
          // own `w:rPrChange`; see applyTrackedRunEmphasisRanges.
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
    // The wire splice lands in the anchor's own story: an insert after a
    // header paragraph joins the header's paragraph list, not the body's.
    const anchorStory = storyOfParagraph(document, operation.paragraph)
    if (!anchorStory) throw new OoxmlError('model-node-not-editable')
    if (trackedWriter) {
      // A tracked batch cannot carry structural insertions, so the
      // post-anchor maps stay empty and the tracked insert chains count on
      // their own.
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
    // Section properties and breaks are not recorded as tracked changes yet.
    // Fail closed rather than apply untracked while the client asked for a
    // tracked edit; the save reports the refusal and holds the change.
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
    // Structural insertions have no tracked form; validateTrackedOperations
    // refuses them before any write. Keep the guard here so a future tracked
    // path cannot slip through silently.
    if (trackedWriter) throw new OoxmlError('model-node-not-editable')
    if (!deletedLater) {
      const key = operation.paragraph.wire.id
      const occurrence = state.tableCounts.get(key) ?? 0
      // `postAnchorTails` is the last wire appended after the anchor — a
      // same-batch paragraph insert or a previous table's last cell — so the
      // new cell wires land where the zero-width overlays serialise.
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
      // The trailing paragraph's overlay is deleted and re-set on every
      // table op, so it serialises after all content appended at this anchor
      // so far — move its wire to the end of the appended region to match.
      // Paragraph inserts do not re-park it: their overlay key stays ahead of
      // the re-set key in serialisation order only when they ran before the
      // last table op. The lookup must be by id: a repeated insert dedupes
      // the wire but mints a fresh object, so an identity search would miss
      // and park a second copy. The wire already parked — not the fresh
      // object — is what moves, so its lineage provenance (keyed by
      // identity) survives the relocation.
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
    // A footnote writes a package part and a relationship — no tracked form —
    // so validateTrackedOperations refuses it before any write.
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
    // A PAGE field has no tracked form either; the field's instruction and
    // characters would need matching tracked markup across five runs.
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
      // The field's tail paragraph is the anchor's post-split half: a later
      // table or paragraph insert at the same anchor chains after it, the
      // same way the serialised output places it after the tail's `</w:p>`.
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
      // As with the contents table: the field's tail is the anchor's
      // post-split half, so later post-anchor insertions chain after it.
      state.postAnchorTails.set(key, inserted.lastWire)
      state.postAnchorCounts.set(
        key,
        (state.postAnchorCounts.get(key) ?? 0) + inserted.appended,
      )
    }
  } else {
    throw new OoxmlError('invalid-document-edit')
  }
}
