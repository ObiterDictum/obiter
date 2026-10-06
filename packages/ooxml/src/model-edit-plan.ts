import {
  EDITABLE_STORY_KINDS,
  PAGE_STORY_KINDS,
  type DocumentEditOperation,
} from '@obiter/contracts'

import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import type { PlannedOperation } from './model-edit-validation'
import type { RunEmphasis } from './model-property-edits'

/**
 * Operation planning: resolve each contract operation's addresses to anchors
 * and reject malformed or unmodelled requests before any overlay write. Kept
 * apart from `model-edits.ts`, which is at its source ceiling carrying the
 * dispatch alone.
 */
export function planOperation(
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
  if (operation.type === 'set_section_properties') return operation
  // Breaks, tables, pictures, hyperlinks and cross-references stay body-only:
  // they write package parts or block-level structure the margin stories do
  // not carry, or relationships the header/footer parts would each need. A
  // footnote reference joins them: its note lives in the shared footnotes
  // story, not in whichever part the reference happened to land in.
  if (
    operation.type === 'insert_break' ||
    operation.type === 'insert_section_break' ||
    operation.type === 'insert_table' ||
    operation.type === 'insert_image' ||
    operation.type === 'set_hyperlink' ||
    operation.type === 'insert_footnote'
  ) {
    const paragraph = requireMainParagraph(document, operation.paragraphId)
    return { ...operation, paragraph }
  }
  if (operation.type === 'insert_cross_reference') {
    return {
      ...operation,
      paragraph: requireMainParagraph(document, operation.paragraphId),
      targetParagraph: requireMainParagraph(
        document,
        operation.targetParagraphId,
      ),
    }
  }
  if (operation.type === 'insert_page_number') {
    // The field resolves the page its story belongs to: body, header or
    // footer. A note story has no page of its own, so the editable-story
    // catch-all below cannot be the check here.
    const paragraph = requireEditableParagraph(document, operation.paragraphId)
    const story = storyOfParagraph(document, paragraph)
    if (!(story && PAGE_STORY_KINDS.has(story.kind))) {
      throw new OoxmlError('model-node-not-editable')
    }
    return { ...operation, paragraph }
  }
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
        paragraph: requireEditableParagraph(document, operation.paragraphId),
      }
    }
    const run = requireEditableRun(document, runParagraphs, runId, false)
    const paragraph = runParagraphs.get(runId)
    if (!paragraph) throw new OoxmlError('model-node-not-editable')
    return { ...operation, run, paragraph }
  }
  if (
    operation.type === 'replace_run_text' ||
    operation.type === 'set_run_style'
  ) {
    const run = requireEditableRun(
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
    paragraph: requireEditableParagraph(document, operation.paragraphId),
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

export function isSectionOperation(operation: PlannedOperation) {
  return (
    operation.type === 'set_section_properties' ||
    operation.type === 'insert_break' ||
    operation.type === 'insert_section_break'
  )
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

export function storyOfParagraph(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
) {
  return document.model.stories.find((item) =>
    item.paragraphs.includes(paragraph.wire),
  )
}

function requireEditableRun(
  document: OoxmlDocument,
  runParagraphs: ReadonlyMap<string, ParagraphAnchor>,
  id: string,
  requireText: boolean,
) {
  const run = document.textRunAnchors.get(id)
  if (!run) throw new OoxmlError('model-node-not-found')
  const paragraph = runParagraphs.get(id)
  const story = paragraph ? storyOfParagraph(document, paragraph) : undefined
  if (
    !(story && EDITABLE_STORY_KINDS.has(story.kind)) ||
    (requireText && run.textRanges.length === 0)
  ) {
    throw new OoxmlError('model-node-not-editable')
  }
  return run
}

function requireMainParagraph(document: OoxmlDocument, id: string) {
  const paragraph = document.paragraphAnchors.get(id)
  if (!paragraph) throw new OoxmlError('model-node-not-found')
  if (storyOfParagraph(document, paragraph)?.kind !== 'document') {
    throw new OoxmlError('model-node-not-editable')
  }
  return paragraph
}

function requireEditableParagraph(document: OoxmlDocument, id: string) {
  const paragraph = document.paragraphAnchors.get(id)
  if (!paragraph) throw new OoxmlError('model-node-not-found')
  const story = storyOfParagraph(document, paragraph)
  if (!(story && EDITABLE_STORY_KINDS.has(story.kind))) {
    throw new OoxmlError('model-node-not-editable')
  }
  return paragraph
}

export function runEmphasisFields(
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
export function trackedRunIdOf(operation: PlannedOperation): string | null {
  if (operation.type === 'replace_run_text') return operation.run.wire.id
  if (operation.type === 'set_run_style') return operation.run.wire.id
  if (operation.type === 'set_run_emphasis') {
    return operation.run?.wire.id ?? null
  }
  return null
}
