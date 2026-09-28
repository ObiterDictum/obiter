import {
  documentEditOperationsSchema,
  insertParagraphRuns,
  type DocumentEditOperation,
} from '@obiter/contracts'
// Range planning stays next to the other operation planners. Split if a third
// addressing mode lands on this dispatcher.
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import {
  recordReplacedRun,
  recordTrackedChanges,
  seedRunOrigins,
  touchParagraph,
  type LineageRecorder,
} from './document-lineage'
import { deleteParagraph, insertParagraphAfter } from './model-paragraph-edits'
import {
  setParagraphNumbering,
  setParagraphFormat,
  setRunEmphasis,
  type RunEmphasis,
} from './model-property-edits'
import {
  applyRunEmphasisRanges,
  type RunEmphasisRange,
} from './model-run-emphasis'
import {
  validatePlannedOperations,
  validateTrackedOperations,
  type PlannedOperation,
} from './model-edit-validation'
import { setParagraphStyle, setRunStyle } from './model-style-edits'
import { replaceTextRunAtAnchor } from './text-run-edit'
import {
  createTrackedEditWriter,
  type TrackedEditContext,
} from './tracked-edits'

export type { TrackedEditContext } from './tracked-edits'

export function applyDocumentEdits(
  document: OoxmlDocument,
  operations: readonly DocumentEditOperation[],
  tracking?: TrackedEditContext,
  lineage?: LineageRecorder,
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
  // Range emphasis is collected per paragraph and applied after the loop.
  // Every operation in a batch addresses the same paragraph text, so the
  // boundaries from all of them must form one split per run; applying them one
  // at a time would let each split overwrite the previous run structure.
  const rangeEmphasis = new Map<ParagraphAnchor, RunEmphasisRange[]>()
  for (const [operationIndex, operation] of planned.entries()) {
    const deletedLater = deletedIds.has(operation.paragraph.wire.id)
    if (lineage)
      touchParagraph(lineage, operation.paragraph.wire, operationIndex)
    if (operation.type === 'replace_run_text') {
      if (deletedLater) continue
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
          // There is no tracked rPrChange writer for a range split. Applying it
          // untracked would silently discard the requested tracking, and
          // skipping it would report a saved formatting change that was never
          // written. Refuse it so the client holds and surfaces the slot.
          if (trackedWriter) throw new OoxmlError('model-node-not-editable')
          const ranges = rangeEmphasis.get(operation.paragraph) ?? []
          ranges.push({
            from: operation.from,
            to: operation.to,
            ...runEmphasisFields(operation),
          })
          rangeEmphasis.set(operation.paragraph, ranges)
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
      const count = insertionCounts.get(operation.paragraphId) ?? 0
      if (trackedWriter) {
        trackedWriter.insertParagraphAfter(
          mainStory,
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
      } else {
        insertParagraphAfter(
          document,
          mainStory,
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
      }
      insertionCounts.set(operation.paragraphId, count + 1)
    } else if (operation.type === 'delete_paragraph') {
      if (trackedWriter) {
        trackedWriter.deleteParagraph(
          operation.paragraph,
          lineage ? { recorder: lineage, operationIndex } : undefined,
        )
      } else {
        deleteParagraph(
          document,
          mainStory,
          operation.paragraph,
          lineage ? { recorder: lineage, operationIndex } : undefined,
        )
      }
    } else {
      throw new OoxmlError('invalid-document-edit')
    }

    // A tracked operation names its reversal by the persisted `w:id`s it just
    // created. Taking them per operation keeps each history step's reversal a
    // unit: a replacement's `del`/`ins` pair is never split from its run.
    if (trackedWriter && lineage) {
      const created = trackedWriter.takeChanges()
      if (created.length > 0) {
        recordTrackedChanges(lineage, created, {
          operationIndex,
          fromParagraphId: operation.paragraph.wire.id,
          fromRunId: trackedRunIdOf(operation),
        })
      }
    }
  }

  for (const [paragraph, ranges] of rangeEmphasis) {
    applyRunEmphasisRanges(document, paragraph, ranges, lineage)
  }
}

function runEmphasisFields(
  operation: Extract<DocumentEditOperation, { type: 'set_run_emphasis' }>,
): RunEmphasis {
  return {
    ...(operation.bold !== undefined ? { bold: operation.bold } : {}),
    ...(operation.italic !== undefined ? { italic: operation.italic } : {}),
    ...(operation.underline !== undefined
      ? { underline: operation.underline }
      : {}),
    ...(operation.fontFamily !== undefined
      ? { fontFamily: operation.fontFamily }
      : {}),
    ...(operation.fontSize !== undefined
      ? { fontSize: operation.fontSize }
      : {}),
    ...(operation.colour !== undefined ? { colour: operation.colour } : {}),
    ...(operation.highlight !== undefined
      ? { highlight: operation.highlight }
      : {}),
    ...(operation.strikethrough !== undefined
      ? { strikethrough: operation.strikethrough }
      : {}),
    ...(operation.vertAlign !== undefined
      ? { vertAlign: operation.vertAlign }
      : {}),
    ...(operation.smallCaps !== undefined
      ? { smallCaps: operation.smallCaps }
      : {}),
  }
}

/** The base run a tracked operation's reversal is keyed to, when run-keyed. */
function trackedRunIdOf(operation: PlannedOperation): string | null {
  if (operation.type === 'replace_run_text') return operation.run.wire.id
  if (operation.type === 'set_run_style') return operation.run.wire.id
  if (operation.type === 'set_run_emphasis') {
    return operation.run?.wire.id ?? null
  }
  return null
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
  validateParagraphFormat(operation)
  validateNumbering(operation, numberingIds)
  if (operation.type === 'set_run_emphasis') {
    const runId = operation.runId
    if (runId === undefined) {
      if (
        operation.paragraphId === undefined ||
        operation.from === undefined ||
        operation.to === undefined
      ) {
        throw new OoxmlError('invalid-document-edit')
      }
      return {
        ...operation,
        paragraph: requireMainParagraph(document, operation.paragraphId),
      }
    }
    const run = requireMainRun(document, runParagraphs, runId, false)
    const paragraph = runParagraphs.get(runId)
    if (!paragraph) throw new OoxmlError('model-node-not-editable')
    return { ...operation, run, paragraph }
  }
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

const RUN_EMPHASIS_KEYS = [
  'bold',
  'italic',
  'underline',
  'fontFamily',
  'fontSize',
  'colour',
  'highlight',
  'strikethrough',
  'vertAlign',
  'smallCaps',
] as const

function validateEmphasis(operation: DocumentEditOperation) {
  if (operation.type !== 'set_run_emphasis') return
  if (!RUN_EMPHASIS_KEYS.some((key) => operation[key] !== undefined)) {
    throw new OoxmlError('invalid-document-edit')
  }
}

function validateParagraphFormat(operation: DocumentEditOperation) {
  if (operation.type !== 'set_paragraph_format') return
  const keys = [
    'alignment',
    'lineSpacing',
    'spaceBefore',
    'spaceAfter',
    'indentation',
  ] as const
  if (!keys.some((key) => operation[key] !== undefined)) {
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
  if (
    operation.type !== 'insert_paragraph_after' &&
    operation.type !== 'insert_paragraph_before'
  ) {
    return
  }
  if (!operation.runs) return
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
