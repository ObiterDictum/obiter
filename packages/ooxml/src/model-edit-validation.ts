import type { DocumentEditOperation } from '@obiter/contracts'

import { assertNoteStoriesKeepParagraph } from './footnote-edits'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'

export type PlannedOperation =
  | (Extract<
      DocumentEditOperation,
      { type: 'replace_run_text' | 'set_run_style' }
    > & { run: TextRunAnchor; paragraph: ParagraphAnchor })
  | (Extract<DocumentEditOperation, { type: 'set_run_emphasis' }> & {
      run?: TextRunAnchor
      paragraph: ParagraphAnchor
    })
  | (Extract<
      DocumentEditOperation,
      {
        type:
          | 'set_paragraph_style'
          | 'set_paragraph_numbering'
          | 'set_paragraph_format'
          | 'insert_paragraph_after'
          | 'insert_paragraph_before'
          | 'delete_paragraph'
          | 'insert_break'
          | 'insert_section_break'
          | 'insert_table'
          | 'insert_image'
          | 'set_hyperlink'
          | 'insert_footnote'
          | 'insert_page_number'
          | 'insert_table_of_contents'
          | 'insert_table_of_authorities'
          | 'mark_defined_term'
      }
    > & { paragraph: ParagraphAnchor })
  | (Extract<DocumentEditOperation, { type: 'insert_cross_reference' }> & {
      paragraph: ParagraphAnchor
      targetParagraph: ParagraphAnchor
    })
  | Extract<DocumentEditOperation, { type: 'set_section_properties' }>

export function validatePlannedOperations(
  document: OoxmlDocument,
  planned: readonly PlannedOperation[],
  tracking: boolean,
) {
  const deletedIds = new Set<string>()
  for (const operation of planned) {
    if (operation.type !== 'delete_paragraph') continue
    if (operation.paragraph.hasTrackedChanges) {
      throw new OoxmlError('model-node-not-editable')
    }
    if (deletedIds.has(operation.paragraph.wire.id)) {
      throw new OoxmlError('invalid-document-edit')
    }
    deletedIds.add(operation.paragraph.wire.id)
  }
  // The last-paragraph invariant holds per story: an untracked delete removes
  // the paragraph from the part it lives in, and a `w:hdr`/`w:ftr` part with
  // no block-level child is as invalid as an empty body. A tracked delete only
  // wraps the paragraph in deleted markup, so the count holds without the
  // guard. Refusing keeps the persisted document structurally valid; the
  // reason is its own code so the caller can report it without matching
  // English text.
  if (!tracking) {
    const insertsByPart = new Map<string, number>()
    const deletesByPart = new Map<string, number>()
    for (const operation of planned) {
      if (!('paragraph' in operation)) continue
      const partName = operation.paragraph.partName
      if (operation.type === 'delete_paragraph') {
        deletesByPart.set(partName, (deletesByPart.get(partName) ?? 0) + 1)
      } else if (
        operation.type === 'insert_paragraph_after' ||
        operation.type === 'insert_paragraph_before'
      ) {
        insertsByPart.set(partName, (insertsByPart.get(partName) ?? 0) + 1)
      }
    }
    for (const [partName, deleted] of deletesByPart) {
      const story = document.model.stories.find(
        (item) => item.partName === partName,
      )
      if (
        story &&
        story.paragraphs.length - deleted + (insertsByPart.get(partName) ?? 0) <
          1
      ) {
        throw new OoxmlError('last-paragraph-required')
      }
    }
    // The same invariant, per note entry: the part-level count above cannot
    // see a `w:footnote` emptied while its siblings survive.
    assertNoteStoriesKeepParagraph(
      document,
      planned.filter(
        (
          operation,
        ): operation is Extract<
          PlannedOperation,
          {
            type:
              | 'insert_paragraph_after'
              | 'insert_paragraph_before'
              | 'delete_paragraph'
          }
        > =>
          operation.type === 'insert_paragraph_after' ||
          operation.type === 'insert_paragraph_before' ||
          operation.type === 'delete_paragraph',
      ),
    )
  }

  const alreadyDeleted = new Set<string>()
  for (const operation of planned) {
    if (
      'paragraph' in operation &&
      operation.type !== 'delete_paragraph' &&
      alreadyDeleted.has(operation.paragraph.wire.id)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
    // A reference to a paragraph deleted anywhere in the batch would write a
    // bookmark the delete then removes — the REF dangles, so refuse instead.
    // `deletedIds` collects every planned `delete_paragraph`, explicit marks
    // and empty-replacement deletes alike, and deletes are emitted last, so
    // `alreadyDeleted` could never see the batch's own deletions.
    if (
      operation.type === 'insert_cross_reference' &&
      deletedIds.has(operation.targetParagraph.wire.id)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
    if (operation.type === 'delete_paragraph') {
      alreadyDeleted.add(operation.paragraph.wire.id)
    }
  }
  return deletedIds
}

export function validateTrackedOperations(
  document: OoxmlDocument,
  planned: readonly PlannedOperation[],
  deletedIds: ReadonlySet<string>,
) {
  // Tracked writers touch disjoint or foldable ranges per op class:
  // tracked-text replaces the whole run, tracked-properties merges into the
  // run's rPr/pPr, and the tracked style and emphasis writers share the
  // tracked-properties replacement. A run may therefore carry a text change
  // and a properties change (or style plus emphasis) in one batch, but only
  // one op per class.
  const runTextTargets = new Set<string>()
  const runStyleTargets = new Set<string>()
  const runEmphasisTargets = new Set<string>()
  const paragraphStyleTargets = new Set<string>()
  const paragraphNumberingTargets = new Set<string>()
  const paragraphFormatTargets = new Set<string>()
  for (const operation of planned) {
    if (!('paragraph' in operation)) continue
    if (deletedIds.has(operation.paragraph.wire.id)) continue
    // Structural insertions have no tracked form yet — a `w:ins` cannot
    // express a new package part or relationship. Fail closed before any
    // write rather than apply untracked while the client asked for tracking.
    if (
      operation.type === 'insert_table' ||
      operation.type === 'insert_image' ||
      operation.type === 'set_hyperlink' ||
      operation.type === 'insert_cross_reference' ||
      operation.type === 'insert_footnote' ||
      operation.type === 'insert_page_number' ||
      operation.type === 'insert_table_of_contents' ||
      operation.type === 'insert_table_of_authorities' ||
      operation.type === 'mark_defined_term'
    ) {
      throw new OoxmlError('model-node-not-editable')
    }
    if (operation.type === 'replace_run_text') {
      if (
        containsTrackedChange(
          document,
          operation.run.partName,
          operation.run.runRange,
        ) ||
        runTextTargets.has(operation.runId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      runTextTargets.add(operation.runId)
    } else if (operation.type === 'set_run_style') {
      if (
        containsTrackedChange(
          document,
          operation.run.partName,
          operation.run.runRange,
        ) ||
        runStyleTargets.has(operation.runId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      runStyleTargets.add(operation.runId)
    } else if (operation.type === 'set_run_emphasis') {
      if (!operation.run) {
        if (
          operation.from === undefined ||
          operation.to === undefined ||
          runEmphasisTargets.has(operation.paragraphId ?? '')
        ) {
          throw new OoxmlError('invalid-document-edit')
        }
        // A range emphasis splits the covered runs and marks each piece's
        // properties, so only the runs the range actually covers must be free
        // of tracked markup — a tracked change beside the range survives the
        // split the way any untouched sibling does.
        let runStart = 0
        for (const run of operation.paragraph.runs) {
          const runEnd = runStart + run.wire.text.length
          if (
            Math.max(operation.from, runStart) <
              Math.min(operation.to, runEnd) &&
            containsTrackedChange(document, run.partName, run.runRange)
          ) {
            throw new OoxmlError('invalid-document-edit')
          }
          runStart = runEnd
        }
        runEmphasisTargets.add(operation.paragraphId ?? '')
      } else if (
        containsTrackedChange(
          document,
          operation.run.partName,
          operation.run.runRange,
        ) ||
        runEmphasisTargets.has(operation.run.wire.id)
      ) {
        throw new OoxmlError('invalid-document-edit')
      } else {
        runEmphasisTargets.add(operation.run.wire.id)
      }
    } else if (operation.type === 'set_paragraph_style') {
      if (
        containsTrackedChange(
          document,
          operation.paragraph.partName,
          operation.paragraph.paragraphRange,
        ) ||
        paragraphStyleTargets.has(operation.paragraphId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      paragraphStyleTargets.add(operation.paragraphId)
    } else if (operation.type === 'set_paragraph_numbering') {
      if (
        containsTrackedChange(
          document,
          operation.paragraph.partName,
          operation.paragraph.paragraphRange,
        ) ||
        paragraphNumberingTargets.has(operation.paragraphId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      paragraphNumberingTargets.add(operation.paragraphId)
    } else if (operation.type === 'set_paragraph_format') {
      if (
        containsTrackedChange(
          document,
          operation.paragraph.partName,
          operation.paragraph.paragraphRange,
        ) ||
        paragraphFormatTargets.has(operation.paragraphId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      paragraphFormatTargets.add(operation.paragraphId)
    }
  }
}

function containsTrackedChange(
  document: OoxmlDocument,
  partName: string,
  range: { start: number; end: number },
) {
  return [...document.trackedChanges.values()].some(
    (change) =>
      change.partName === partName &&
      change.range.start >= range.start &&
      change.range.end <= range.end,
  )
}
