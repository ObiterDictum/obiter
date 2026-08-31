import {
  documentEditOperationsSchema,
  insertParagraphRuns,
  type DocumentEditOperation,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { deleteParagraph, insertParagraphAfter } from './model-paragraph-edits'
import { setParagraphNumbering, setRunEmphasis } from './model-property-edits'
import { setParagraphStyle, setRunStyle } from './model-style-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'
import {
  createTrackedEditWriter,
  type TrackedEditContext,
} from './tracked-edits'

export type { TrackedEditContext } from './tracked-edits'

type PlannedOperation =
  | (Extract<
      DocumentEditOperation,
      { type: 'replace_run_text' | 'set_run_style' | 'set_run_emphasis' }
    > & { run: TextRunAnchor; paragraph: ParagraphAnchor })
  | (Extract<
      DocumentEditOperation,
      {
        type:
          | 'set_paragraph_style'
          | 'set_paragraph_numbering'
          | 'insert_paragraph_after'
          | 'delete_paragraph'
      }
    > & { paragraph: ParagraphAnchor })

export function applyDocumentEdits(
  document: OoxmlDocument,
  operations: readonly DocumentEditOperation[],
  tracking?: TrackedEditContext,
) {
  const parsed = documentEditOperationsSchema.safeParse(operations)
  if (!parsed.success) throw new OoxmlError('invalid-document-edit')

  const mainStory = document.model.stories.find(
    (story) => story.kind === 'document',
  )
  if (!mainStory) throw new OoxmlError('model-node-not-editable')
  const mainPart = document.sourceParts.get(mainStory.partName)
  if (!mainPart?.overlay || mainPart.kind !== 'xml') {
    throw new OoxmlError('model-node-not-editable')
  }

  const styleIds = new Set(document.model.styles.map(({ styleId }) => styleId))
  const numberingIds = new Set(
    document.model.numbering.map(({ numberingId }) => numberingId),
  )
  const runParagraphs = new Map(
    [...document.paragraphAnchors.values()].flatMap((paragraph) =>
      paragraph.runs.map((run) => [run.wire.id, paragraph] as const),
    ),
  )
  const planned = parsed.data.map((operation) =>
    planOperation(document, runParagraphs, operation, styleIds, numberingIds),
  )
  const deletedIds = validatePlannedOperations(
    mainStory.paragraphs.length,
    planned,
    tracking !== undefined,
  )
  if (tracking) validateTrackedOperations(document, planned, deletedIds)
  const trackedWriter = tracking
    ? createTrackedEditWriter(document, tracking)
    : undefined

  const insertionCounts = new Map<string, number>()
  for (const operation of planned) {
    const deletedLater = deletedIds.has(operation.paragraph.wire.id)
    if (operation.type === 'replace_run_text') {
      if (deletedLater) continue
      if (trackedWriter) {
        trackedWriter.replaceRunText(operation.run, operation.text)
      } else if (
        !replaceTextRunAtAnchor(document, operation.run, operation.text)
      ) {
        throw new OoxmlError('model-node-not-editable')
      }
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
          trackedWriter.setParagraphStyle(
            operation.paragraph,
            operation.styleId,
          )
        } else {
          setParagraphStyle(document, operation.paragraph, operation.styleId)
        }
      }
    } else if (operation.type === 'set_run_emphasis') {
      if (!deletedLater) {
        if (trackedWriter) {
          trackedWriter.setRunEmphasis(operation.run, operation)
        } else {
          setRunEmphasis(document, operation.run, operation)
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
    } else if (operation.type === 'insert_paragraph_after') {
      const count = insertionCounts.get(operation.paragraphId) ?? 0
      if (trackedWriter) {
        trackedWriter.insertParagraphAfter(
          mainStory,
          operation.paragraph,
          insertParagraphRuns(operation),
          operation.styleId,
          count,
        )
      } else {
        insertParagraphAfter(
          document,
          mainStory,
          operation.paragraph,
          insertParagraphRuns(operation),
          operation.styleId,
          count,
        )
      }
      insertionCounts.set(operation.paragraphId, count + 1)
    } else if (operation.type === 'delete_paragraph') {
      if (trackedWriter) {
        trackedWriter.deleteParagraph(operation.paragraph)
      } else {
        deleteParagraph(document, mainStory, operation.paragraph)
      }
    } else {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

function validatePlannedOperations(
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

function validateTrackedOperations(
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
      if (
        containsTrackedChange(
          document,
          operation.run.partName,
          operation.run.runRange,
        ) ||
        runEmphasisTargets.has(operation.runId)
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      runEmphasisTargets.add(operation.runId)
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

function planOperation(
  document: OoxmlDocument,
  runParagraphs: ReadonlyMap<string, ParagraphAnchor>,
  operation: DocumentEditOperation,
  styleIds: ReadonlySet<string>,
  numberingIds: ReadonlySet<string>,
): PlannedOperation {
  validateStyle(operation, styleIds)
  validateEmphasis(operation)
  validateNumbering(operation, numberingIds)
  if (
    operation.type === 'replace_run_text' ||
    operation.type === 'set_run_style' ||
    operation.type === 'set_run_emphasis'
  ) {
    const run = requireMainRun(
      document,
      runParagraphs,
      operation.runId,
      operation.type === 'replace_run_text',
    )
    const paragraph = runParagraphs.get(operation.runId)
    if (!paragraph) throw new OoxmlError('model-node-not-editable')
    return { ...operation, run, paragraph }
  }
  return {
    ...operation,
    paragraph: requireMainParagraph(document, operation.paragraphId),
  }
}

function validateEmphasis(operation: DocumentEditOperation) {
  if (operation.type !== 'set_run_emphasis') return
  if (
    operation.bold == null &&
    operation.italic == null &&
    operation.underline == null
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
}

function validateNumbering(
  operation: DocumentEditOperation,
  numberingIds: ReadonlySet<string>,
) {
  if (operation.type !== 'set_paragraph_numbering') return
  if (operation.numId !== null) {
    if (!numberingIds.has(operation.numId) || operation.ilvl === undefined) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

function validateStyle(
  operation: DocumentEditOperation,
  styleIds: ReadonlySet<string>,
) {
  if (
    'styleId' in operation &&
    operation.styleId !== null &&
    operation.styleId !== undefined &&
    !styleIds.has(operation.styleId)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  if (operation.type !== 'insert_paragraph_after' || !operation.runs) return
  for (const run of operation.runs) {
    if (run.styleId && !styleIds.has(run.styleId)) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

function requireMainRun(
  document: OoxmlDocument,
  runParagraphs: ReadonlyMap<string, ParagraphAnchor>,
  id: string,
  requireText: boolean,
) {
  const run = document.textRunAnchors.get(id)
  if (!run) throw new OoxmlError('model-node-not-found')
  const paragraph = runParagraphs.get(id)
  const story = paragraph
    ? document.model.stories.find((item) =>
        item.paragraphs.includes(paragraph.wire),
      )
    : undefined
  if (
    story?.kind !== 'document' ||
    (requireText && run.textRanges.length === 0)
  ) {
    throw new OoxmlError('model-node-not-editable')
  }
  return run
}

function requireMainParagraph(document: OoxmlDocument, id: string) {
  const paragraph = document.paragraphAnchors.get(id)
  if (!paragraph) throw new OoxmlError('model-node-not-found')
  const story = document.model.stories.find((item) =>
    item.paragraphs.includes(paragraph.wire),
  )
  if (story?.kind !== 'document') {
    throw new OoxmlError('model-node-not-editable')
  }
  return paragraph
}
