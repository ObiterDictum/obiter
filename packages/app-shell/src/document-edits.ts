import type {
  DocumentEditOperation,
  DocumentModelWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'
import {
  collectFormatOperations,
  emptyFormatDrafts,
  type FormatDrafts,
} from './document-format-edits'

export type LocalInsert = {
  clientId: string
  afterParagraphId: string
  text: string
  runs?: DocumentTextRunWire[]
}

export function insertPlainText(insert: LocalInsert): string {
  if (insert.runs && insert.runs.length > 0) {
    const joined = insert.runs.map((run) => run.text).join('')
    return joined.length > 0 ? joined : insert.text
  }
  return insert.text
}

export function insertRuns(insert: LocalInsert): DocumentTextRunWire[] {
  if (insert.runs && insert.runs.length > 0) {
    const joined = insert.runs.map((run) => run.text).join('')
    if (joined.length > 0 || !insert.text) return insert.runs
    return [{ ...insert.runs[0], text: insert.text }]
  }
  return [
    {
      id: insert.clientId,
      text: insert.text,
      preservedXmlFragments: [],
    },
  ]
}

export function removeInsert(
  inserts: LocalInsert[],
  clientId: string,
): { inserts: LocalInsert[]; selectId: string } | undefined {
  const removed = inserts.find((item) => item.clientId === clientId)
  if (!removed) return undefined
  return {
    inserts: inserts
      .filter((item) => item.clientId !== clientId)
      .map((item) =>
        item.afterParagraphId === clientId
          ? { ...item, afterParagraphId: removed.afterParagraphId }
          : item,
      ),
    selectId: removed.afterParagraphId,
  }
}

export function flowParagraphIds(
  model: DocumentModelWire,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
): string[] {
  const deleted = new Set(deletedParagraphIds)
  const byAfter = new Map<string, LocalInsert[]>()
  for (const insert of inserts) {
    const list = byAfter.get(insert.afterParagraphId) ?? []
    list.push(insert)
    byAfter.set(insert.afterParagraphId, list)
  }
  const ids: string[] = []
  const appendInserts = (id: string) => {
    for (const insert of byAfter.get(id) ?? []) {
      ids.push(insert.clientId)
      appendInserts(insert.clientId)
    }
  }
  for (const paragraph of documentStory(model)?.paragraphs ?? []) {
    if (!deleted.has(paragraph.id)) ids.push(paragraph.id)
    appendInserts(paragraph.id)
  }
  return ids
}

export function collectEditOperations(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  const story = documentStory(model)
  const deleted = new Set(deletedParagraphIds)
  const emptyReplacements: string[] = []

  for (const paragraph of story?.paragraphs ?? []) {
    if (deleted.has(paragraph.id)) continue
    const extraText = (extraRuns[paragraph.id] ?? [])
      .map((run) => drafts[run.id] ?? run.text)
      .join('')
    if (paragraph.runs.length === 0) {
      if (extraText) {
        operations.push({
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          text: extraText,
          ...(paragraph.styleId ? { styleId: paragraph.styleId } : {}),
        })
        emptyReplacements.push(paragraph.id)
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
  }

  const realIds = new Set(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.id),
  )
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  for (const id of flowParagraphIds(model, inserts, deletedParagraphIds)) {
    const insert = insertById.get(id)
    if (!insert) continue
    operations.push({
      type: 'insert_paragraph_after',
      paragraphId: resolveInsertAnchor(insert, insertById, realIds),
      ...insertPayload(insert),
    })
  }

  for (const paragraphId of deletedParagraphIds) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  for (const paragraphId of emptyReplacements) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }
  operations.push(
    ...collectFormatOperations(model, format, deletedParagraphIds),
  )

  return operations
}

function insertPayload(insert: LocalInsert) {
  if (!insert.runs || insert.runs.length === 0) return { text: insert.text }
  return {
    runs: insertRuns(insert).map((run) => {
      const xml = run.preservedXmlFragments.join('')
      return {
        text: run.text,
        ...(run.styleId ? { styleId: run.styleId } : {}),
        ...(wordToggleOn(xml, 'b') ? { bold: true as const } : {}),
        ...(wordToggleOn(xml, 'i') ? { italic: true as const } : {}),
        ...(wordUnderlineOn(xml) ? { underline: true as const } : {}),
      }
    }),
  }
}

function wordToggleOn(xml: string, name: 'b' | 'i') {
  const tag = xml.match(
    name === 'b' ? /<w:b\b([^>]*)\/?>/i : /<w:i\b([^>]*)\/?>/i,
  )
  if (!tag) return false
  const value = tag[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return value !== '0' && value !== 'false' && value !== 'off'
}

function wordUnderlineOn(xml: string) {
  const tag = xml.match(/<w:u\b([^>]*)\/?>/i)
  if (!tag) return false
  const value = tag[1]?.match(/w:val="([^"]+)"/i)?.[1]?.toLowerCase()
  return value !== 'none' && value !== '0' && value !== 'false'
}

function resolveInsertAnchor(
  insert: LocalInsert,
  insertById: ReadonlyMap<string, LocalInsert>,
  realIds: ReadonlySet<string>,
): string {
  let id = insert.afterParagraphId
  const seen = new Set<string>()
  while (!realIds.has(id)) {
    if (seen.has(id)) return insert.afterParagraphId
    seen.add(id)
    const parent = insertById.get(id)
    if (!parent) return insert.afterParagraphId
    id = parent.afterParagraphId
  }
  return id
}

export function isDraftDirty(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
  format: FormatDrafts = emptyFormatDrafts,
) {
  return (
    collectEditOperations(
      model,
      drafts,
      inserts,
      deletedParagraphIds,
      extraRuns,
      format,
    ).length > 0
  )
}

export function selectedParagraphLength(
  model: DocumentModelWire,
  paragraphId: string | null,
) {
  if (!paragraphId) return 0
  const paragraph = documentStory(model)?.paragraphs.find(
    (item) => item.id === paragraphId,
  )
  return paragraph ? paragraphPlainText(paragraph).length : 0
}

export function downloadPlainText(filename: string, text: string) {
  downloadBlob(
    `${filename.replace(/\.[^.]+$/u, '')}.txt`,
    new Blob([text], { type: 'text/plain;charset=utf-8' }),
  )
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
