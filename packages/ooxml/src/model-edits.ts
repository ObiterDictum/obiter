import {
  documentEditOperationsSchema,
  type DocumentEditOperation,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type SourcePart,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import {
  escapeXmlAttribute,
  escapeXmlText,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
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
  if (mainStory.paragraphs.length - deletedIds.size < 1) {
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

function setRunStyle(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  styleId: string | null,
) {
  const part = requireEditablePart(document, anchor.partName)
  setStyleInstruction(part.overlay, {
    key: `${anchor.wire.id}:style`,
    nodeRange: anchor.runRange,
    propertiesRange: anchor.runPropertiesRange,
    styleRange: anchor.runStyleRange,
    propertiesName: 'rPr',
    styleName: 'rStyle',
    styleId,
  })
  updateWireStyle(anchor.wire, styleId)
  part.dirty = true
}

function setParagraphStyle(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  styleId: string | null,
) {
  const part = requireEditablePart(document, anchor.partName)
  setStyleInstruction(part.overlay, {
    key: `${anchor.wire.id}:style`,
    nodeRange: anchor.paragraphRange,
    propertiesRange: anchor.paragraphPropertiesRange,
    styleRange: anchor.paragraphStyleRange,
    propertiesName: 'pPr',
    styleName: 'pStyle',
    styleId,
  })
  updateWireStyle(anchor.wire, styleId)
  part.dirty = true
}

function setStyleInstruction(
  overlay: XmlOverlay,
  input: {
    key: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    styleRange?: XmlElementRange
    propertiesName: 'pPr' | 'rPr'
    styleName: 'pStyle' | 'rStyle'
    styleId: string | null
  },
) {
  if (input.styleRange) {
    setOverlayReplacement(overlay, input.key, {
      start: input.styleRange.start,
      end: input.styleRange.end,
      value:
        input.styleId === null
          ? ''
          : patchStyleValue(
              overlay.source.slice(
                input.styleRange.start,
                input.styleRange.end,
              ),
              input.styleId,
            ),
    })
    return
  }
  if (input.styleId === null) {
    overlay.replacements.delete(input.key)
    return
  }

  const instruction = `<w:${input.styleName} w:val="${escapeXmlAttribute(input.styleId)}"/>`
  if (!input.propertiesRange) {
    setOverlayReplacement(overlay, input.key, {
      start: input.nodeRange.startTagEnd,
      end: input.nodeRange.startTagEnd,
      value: `<w:${input.propertiesName}>${instruction}</w:${input.propertiesName}>`,
    })
    return
  }
  if (input.propertiesRange.endTagStart === input.propertiesRange.end) {
    const opening = overlay.source.slice(
      input.propertiesRange.start,
      input.propertiesRange.end,
    )
    setOverlayReplacement(overlay, input.key, {
      start: input.propertiesRange.start,
      end: input.propertiesRange.end,
      value: `${opening.replace(/\/\s*>$/u, '>')}${instruction}</w:${input.propertiesName}>`,
    })
    return
  }
  setOverlayReplacement(overlay, input.key, {
    start: input.propertiesRange.startTagEnd,
    end: input.propertiesRange.startTagEnd,
    value: instruction,
  })
}

function patchStyleValue(fragment: string, styleId: string) {
  const escaped = escapeXmlAttribute(styleId)
  const value = /(\s+w:val\s*=\s*)(["'])([^"']*)\2/u
  if (value.test(fragment)) return fragment.replace(value, `$1$2${escaped}$2`)
  return fragment.replace(/(\/\s*>|>)$/u, ` w:val="${escaped}"$1`)
}

function updateWireStyle(
  wire: DocumentTextRunWire | DocumentParagraphWire,
  styleId: string | null,
) {
  if (styleId === null) delete wire.styleId
  else wire.styleId = styleId
}

function insertParagraphAfter(
  document: OoxmlDocument,
  story: DocumentModelWire['stories'][number],
  anchor: ParagraphAnchor,
  text: string,
  styleId: string | null | undefined,
  offset: number,
) {
  const part = requireEditablePart(document, anchor.partName)
  const paragraphId = allocateModelId(document, 'para-edit')
  const runId = allocateModelId(document, 'text-edit')
  const run: DocumentTextRunWire = {
    id: runId,
    text,
    preservedXmlFragments: [],
  }
  const paragraph: DocumentParagraphWire = {
    id: paragraphId,
    ...(styleId ? { styleId } : {}),
    runs: [run],
    preservedXmlFragments: [],
  }
  const index = story.paragraphs.indexOf(anchor.wire)
  story.paragraphs.splice(index + 1 + offset, 0, paragraph)
  const properties = styleId
    ? `<w:pPr><w:pStyle w:val="${escapeXmlAttribute(styleId)}"/></w:pPr>`
    : ''
  const xmlSpace = /^\s|\s$/u.test(text) ? ' xml:space="preserve"' : ''
  setOverlayReplacement(part.overlay, `${paragraphId}:insert`, {
    start: anchor.paragraphRange.end,
    end: anchor.paragraphRange.end,
    value: `<w:p>${properties}<w:r><w:t${xmlSpace}>${escapeXmlText(text)}</w:t></w:r></w:p>`,
  })
  part.dirty = true
}

function deleteParagraph(
  document: OoxmlDocument,
  story: DocumentModelWire['stories'][number],
  anchor: ParagraphAnchor,
) {
  const part = requireEditablePart(document, anchor.partName)
  setOverlayReplacement(part.overlay, `${anchor.wire.id}:delete`, {
    start: anchor.paragraphRange.start,
    end: anchor.paragraphRange.end,
    value: '',
  })
  story.paragraphs.splice(story.paragraphs.indexOf(anchor.wire), 1)
  part.dirty = true
}

function requireEditablePart(
  document: OoxmlDocument,
  partName: string,
): SourcePart & { kind: 'xml'; overlay: XmlOverlay } {
  const part = document.sourceParts.get(partName)
  if (!isEditablePart(part)) {
    throw new OoxmlError('model-node-not-editable')
  }
  return part
}

function isEditablePart(
  part: SourcePart | undefined,
): part is SourcePart & { kind: 'xml'; overlay: XmlOverlay } {
  return part?.kind === 'xml' && part.overlay !== undefined
}

function allocateModelId(document: OoxmlDocument, prefix: string) {
  const used = new Set(
    document.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((paragraph) => [
        paragraph.id,
        ...paragraph.runs.map(({ id }) => id),
      ]),
    ),
  )
  let sequence = 1
  while (used.has(`${prefix}-${String(sequence).padStart(6, '0')}`)) {
    sequence += 1
  }
  return `${prefix}-${String(sequence).padStart(6, '0')}`
}
