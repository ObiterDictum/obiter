import { revisionOnlyParagraph } from './document-inline-index'
import {
  type DocumentEditOperation,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'
import type { BreakDraft } from './document-draft-state'
import {
  collectFormatOperations,
  emptyFormatDrafts,
  type FormatDrafts,
} from './document-format-edits'
import type { HighlightValue, VertAlignValue } from './document-format-types'
import { editableStories, runsText } from './document-model-text'
import {
  runColour,
  runFlag,
  runFontFamily,
  runFontSize,
  runHighlight,
  runUnderline,
  runVertAlign,
  withoutTrackedRunProperties,
} from './document-run-properties'
import {
  flowIds,
  insertRuns,
  resolveInsertAnchor,
  type LocalInsert,
} from './document-story-flow'
import {
  structuralEditOperations,
  type StructuralDraft,
} from './document-structural-drafts'

export type RunEditProperties = {
  bold: boolean | null
  italic: boolean | null
  underline: boolean | null
  fontFamily: string | null
  fontSize: number | null
  colour: string | null
  highlight: HighlightValue | null
  strikethrough: boolean | null
  vertAlign: VertAlignValue | null
  smallCaps: boolean | null
}

export function runPropertiesFromFragments(
  fragments: readonly string[],
): RunEditProperties {
  const xml = withoutTrackedRunProperties(fragments.join(''))
  return {
    bold: runFlag(xml, 'b'),
    italic: runFlag(xml, 'i'),
    underline: runUnderline(xml),
    fontFamily: runFontFamily(xml),
    fontSize: runFontSize(xml),
    colour: runColour(xml),
    highlight: runHighlight(xml),
    strikethrough: runFlag(xml, 'strike'),
    vertAlign: runVertAlign(xml),
    smallCaps: runFlag(xml, 'smallCaps'),
  }
}

export function compactRunProperties(properties: RunEditProperties) {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== null),
  )
}

export function sameRunProperties(
  a: RunEditProperties,
  b: RunEditProperties,
): boolean {
  // SAFETY: Object.keys of a RunEditProperties value yields its own property names, which are exactly the keys of RunEditProperties.
  return (Object.keys(a) as Array<keyof RunEditProperties>).every(
    (key) => a[key] === b[key],
  )
}

export function replacedEmptyParagraphIds(
  paragraphs: readonly DocumentParagraphWire[],
  extraRuns: Record<string, DocumentTextRunWire[]>,
  drafts: Record<string, string>,
  model: DocumentModelWire,
): Set<string> {
  const replaced = new Set<string>()
  for (const paragraph of paragraphs) {
    if (paragraph.runs.length !== 0 || revisionOnlyParagraph(model, paragraph))
      continue
    if (
      (extraRuns[paragraph.id] ?? []).some(
        (run) => (drafts[run.id] ?? run.text).length > 0,
      )
    ) {
      replaced.add(paragraph.id)
    }
  }
  return replaced
}

export function collectEditOperations(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
  breaks: BreakDraft[] = [],
  structures: StructuralDraft[] = [],
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  const paragraphs = editableStories(model).flatMap((story) => story.paragraphs)
  const deleted = new Set(deletedParagraphIds)
  const emptyReplacements = replacedEmptyParagraphIds(
    paragraphs,
    extraRuns,
    drafts,
    model,
  )
  for (const paragraphId of deleted) emptyReplacements.delete(paragraphId)

  for (const paragraph of paragraphs) {
    if (deleted.has(paragraph.id)) continue
    const extra = extraRuns[paragraph.id] ?? []
    const extraText = extra.map((run) => drafts[run.id] ?? run.text).join('')
    if (paragraph.runs.length === 0) {
      if (emptyReplacements.has(paragraph.id)) {
        operations.push({
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          ...extraParagraphPayload(extra, drafts),
          ...(paragraph.styleId ? { styleId: paragraph.styleId } : {}),
        })
      }
      continue
    }
    for (const [index, run] of paragraph.runs.entries()) {
      const last = index === paragraph.runs.length - 1
      const draft =
        last && extraText
          ? `${drafts[run.id] ?? run.text}${extraText}`
          : drafts[run.id]
      if (draft !== undefined && draft !== run.text) {
        operations.push({
          type: 'replace_run_text',
          runId: run.id,
          text: draft,
        })
      }
    }
    operations.push(...appendedRunEmphasis(paragraph, extra, drafts))
  }

  const realIds = new Set(paragraphs.map((paragraph) => paragraph.id))
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  operations.push(
    ...collectFormatOperations(
      model,
      format,
      deletedParagraphIds,
      new Set(insertById.keys()),
    ),
  )

  for (const item of breaks) {
    if (deleted.has(item.paragraphId)) continue
    if (item.kind === 'page') {
      operations.push({
        type: 'insert_break',
        paragraphId: item.paragraphId,
        offset: item.offset,
        kind: 'page',
      })
    } else {
      operations.push({
        type: 'insert_section_break',
        paragraphId: item.paragraphId,
      })
    }
  }

  const insertOrder = editableStories(model).flatMap((story) =>
    flowIds(
      story.paragraphs.map((paragraph) => paragraph.id),
      inserts,
      deleted,
    ),
  )
  for (const id of insertOrder) {
    const insert = insertById.get(id)
    if (!insert) continue
    const style = format.paragraphStyles[insert.clientId]
    const anchor = resolveInsertAnchor(insert, insertById, realIds)
    const before = insert.beforeParagraphId !== undefined
    operations.push({
      type: before ? 'insert_paragraph_before' : 'insert_paragraph_after',
      paragraphId: anchor,
      intentId: insert.clientId,
      ...insertPayload(insert),
      ...(style ? { styleId: style } : {}),
    })
  }

  operations.push(
    ...structuralEditOperations(
      structures,
      new Set([...deleted, ...emptyReplacements]),
      drafts,
      extraRuns,
    ),
  )

  for (const paragraphId of deletedParagraphIds) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  for (const paragraphId of emptyReplacements) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }

  return operations
}

function insertPayload(insert: LocalInsert) {
  if (!insert.runs || insert.runs.length === 0) return { text: insert.text }
  return {
    runs: insertRuns(insert).map((run) => ({
      text: run.text,
      ...(run.styleId ? { styleId: run.styleId } : {}),
      ...compactRunProperties(
        runPropertiesFromFragments(run.preservedXmlFragments),
      ),
    })),
  }
}

function extraParagraphPayload(
  runs: readonly DocumentTextRunWire[],
  drafts: Record<string, string>,
) {
  const payload = runs.map((run) => ({
    text: drafts[run.id] ?? run.text,
    ...(run.styleId ? { styleId: run.styleId } : {}),
    ...compactRunProperties(
      runPropertiesFromFragments(run.preservedXmlFragments),
    ),
  }))
  const formatted = payload.some((run) => Object.keys(run).length > 1)
  return formatted ? { runs: payload } : { text: runsText(payload) }
}

function appendedRunEmphasis(
  paragraph: { id: string; runs: DocumentTextRunWire[] },
  extra: readonly DocumentTextRunWire[],
  drafts: Record<string, string>,
): DocumentEditOperation[] {
  if (extra.length === 0) return []
  const last = paragraph.runs[paragraph.runs.length - 1]
  if (!last) return []
  const operations: DocumentEditOperation[] = []
  let cursor = paragraph.runs.reduce(
    (sum, run) => sum + (drafts[run.id] ?? run.text).length,
    0,
  )
  let previous = runPropertiesFromFragments(last.preservedXmlFragments)
  for (const run of extra) {
    const text = drafts[run.id] ?? run.text
    const properties = runPropertiesFromFragments(run.preservedXmlFragments)
    if (text.length > 0 && !sameRunProperties(properties, previous)) {
      operations.push({
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: cursor,
        to: cursor + text.length,
        ...properties,
      })
    }
    cursor += text.length
    previous = properties
  }
  return operations
}
