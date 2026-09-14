import type { DocumentEditOperation } from '@obiter/contracts'

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
          | 'delete_paragraph'
      }
    > & { paragraph: ParagraphAnchor })

export function validatePlannedOperations(
  paragraphCount: number,
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
  const insertCount = planned.filter(
    (operation) => operation.type === 'insert_paragraph_after',
  ).length
  if (!tracking && paragraphCount - deletedIds.size + insertCount < 1) {
    throw new OoxmlError('model-node-not-editable')
  }

  const alreadyDeleted = new Set<string>()
  for (const operation of planned) {
    if (
      operation.type !== 'delete_paragraph' &&
      alreadyDeleted.has(operation.paragraph.wire.id)
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
    if (deletedIds.has(operation.paragraph.wire.id)) continue
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
          containsTrackedChange(
            document,
            operation.paragraph.partName,
            operation.paragraph.paragraphRange,
          ) ||
          runEmphasisTargets.has(operation.paragraphId ?? '')
        ) {
          throw new OoxmlError('invalid-document-edit')
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
