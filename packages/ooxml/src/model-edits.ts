import {
  documentEditOperationsSchema,
  type DocumentEditOperation,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
} from './model'
import { deleteParagraph, insertParagraphAfter } from './model-paragraph-edits'
import { setParagraphStyle, setRunStyle } from './model-style-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'

type PlannedOperation =
  | (Extract<
      DocumentEditOperation,
      { type: 'replace_run_text' | 'set_run_style' }
    > & { run: TextRunAnchor; paragraph: ParagraphAnchor })
  | (Extract<
      DocumentEditOperation,
      {
        type:
          'set_paragraph_style' | 'insert_paragraph_after' | 'delete_paragraph'
      }
    > & { paragraph: ParagraphAnchor })

export function applyDocumentEdits(
  document: OoxmlDocument,
  operations: readonly DocumentEditOperation[],
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
  const runParagraphs = new Map(
    [...document.paragraphAnchors.values()].flatMap((paragraph) =>
      paragraph.runs.map((run) => [run.wire.id, paragraph] as const),
    ),
  )
  const planned = parsed.data.map((operation) =>
    planOperation(document, runParagraphs, operation, styleIds),
  )
  const deletedIds = validatePlannedOperations(
    mainStory.paragraphs.length,
    planned,
  )

  const insertionCounts = new Map<string, number>()
  for (const operation of planned) {
    const deletedLater = deletedIds.has(operation.paragraph.wire.id)
    if (operation.type === 'replace_run_text') {
      if (deletedLater) continue
      if (!replaceTextRunAtAnchor(document, operation.run, operation.text)) {
        throw new OoxmlError('model-node-not-editable')
      }
    } else if (operation.type === 'set_run_style') {
      if (!deletedLater) setRunStyle(document, operation.run, operation.styleId)
    } else if (operation.type === 'set_paragraph_style') {
      if (!deletedLater) {
        setParagraphStyle(document, operation.paragraph, operation.styleId)
      }
    } else if (operation.type === 'insert_paragraph_after') {
      const count = insertionCounts.get(operation.paragraphId) ?? 0
      insertParagraphAfter(
        document,
        mainStory,
        operation.paragraph,
        operation.text,
        operation.styleId,
        count,
      )
      insertionCounts.set(operation.paragraphId, count + 1)
    } else {
      deleteParagraph(document, mainStory, operation.paragraph)
    }
  }
}

function validatePlannedOperations(
  paragraphCount: number,
  planned: readonly PlannedOperation[],
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
  if (paragraphCount - deletedIds.size < 1) {
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

function planOperation(
  document: OoxmlDocument,
  runParagraphs: ReadonlyMap<string, ParagraphAnchor>,
  operation: DocumentEditOperation,
  styleIds: ReadonlySet<string>,
): PlannedOperation {
  validateStyle(operation, styleIds)
  if (
    operation.type === 'replace_run_text' ||
    operation.type === 'set_run_style'
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
