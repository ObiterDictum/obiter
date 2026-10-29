import type { DocumentEditOperation } from '@obiter/contracts'

import { fieldBoundarySplit } from './field-spans'
import { assertNoteStoriesKeepParagraph } from './footnote-edits'
import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { parseXmlElements } from './parts/overlay'

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
          | 'update_table_of_authorities'
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

  const deleteRangesByPart = new Map<string, { start: number; end: number }[]>()
  for (const operation of planned) {
    if (operation.type !== 'delete_paragraph') continue
    const ranges = deleteRangesByPart.get(operation.paragraph.partName) ?? []
    ranges.push(operation.paragraph.paragraphRange)
    deleteRangesByPart.set(operation.paragraph.partName, ranges)
  }
  for (const [partName, ranges] of deleteRangesByPart) {
    const part = document.sourceParts.get(partName)
    if (part?.kind !== 'xml' || part.overlay === undefined) {
      throw new OoxmlError('invalid-document-edit')
    }
    if (
      fieldBoundarySplit(
        parseXmlElements(part.overlay.source),
        part.overlay.source,
        ranges,
      )
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  return deletedIds
}

export function validateTrackedOperations(
  document: OoxmlDocument,
  planned: readonly PlannedOperation[],
  deletedIds: ReadonlySet<string>,
) {
  const runTextTargets = new Set<string>()
  const runStyleTargets = new Set<string>()
  const runEmphasisTargets = new Set<string>()
  const paragraphStyleTargets = new Set<string>()
  const paragraphNumberingTargets = new Set<string>()
  const paragraphFormatTargets = new Set<string>()
  for (const operation of planned) {
    if (!('paragraph' in operation)) continue
    if (deletedIds.has(operation.paragraph.wire.id)) continue
    if (
      operation.type === 'insert_table' ||
      operation.type === 'insert_image' ||
      operation.type === 'set_hyperlink' ||
      operation.type === 'insert_cross_reference' ||
      operation.type === 'insert_footnote' ||
      operation.type === 'insert_page_number' ||
      operation.type === 'insert_table_of_contents' ||
      operation.type === 'insert_table_of_authorities' ||
      operation.type === 'update_table_of_authorities' ||
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
