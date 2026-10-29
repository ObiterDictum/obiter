import type {
  DocumentModelWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  documentStory,
  editableParagraphs,
  editableStoryOf,
  runsText,
} from './document-model-text'
import { drawingFloat, paragraphAnchorXml } from './document-page-floats'
import { storyBlocks } from './document-page-tables'

export type LocalInsert = {
  clientId: string
  afterParagraphId: string
  beforeParagraphId?: string
  text: string
  runs?: DocumentTextRunWire[]
}

export function insertPlainText(insert: LocalInsert): string {
  if (insert.runs && insert.runs.length > 0) {
    const joined = runsText(insert.runs)
    return joined.length > 0 ? joined : insert.text
  }
  return insert.text
}

export function insertRuns(insert: LocalInsert): DocumentTextRunWire[] {
  if (insert.runs && insert.runs.length > 0) {
    const joined = runsText(insert.runs)
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
      .map((item) => {
        if (item.afterParagraphId === clientId) {
          return { ...item, afterParagraphId: removed.afterParagraphId }
        }
        if (item.beforeParagraphId === clientId) {
          return { ...item, beforeParagraphId: removed.afterParagraphId }
        }
        return item
      }),
    selectId: removed.afterParagraphId,
  }
}

const noOmitHosts: ReadonlySet<string> = new Set()

export function flowIds(
  hostIds: readonly string[],
  inserts: readonly LocalInsert[],
  omitHosts: ReadonlySet<string> = noOmitHosts,
): string[] {
  const byAfter = new Map<string, LocalInsert[]>()
  const byBefore = new Map<string, LocalInsert[]>()
  for (const insert of inserts) {
    if (insert.beforeParagraphId) {
      const list = byBefore.get(insert.beforeParagraphId) ?? []
      list.push(insert)
      byBefore.set(insert.beforeParagraphId, list)
    } else {
      const list = byAfter.get(insert.afterParagraphId) ?? []
      list.push(insert)
      byAfter.set(insert.afterParagraphId, list)
    }
  }
  const ids: string[] = []
  const appendInserts = (id: string) => {
    for (const insert of byAfter.get(id) ?? []) {
      ids.push(insert.clientId)
      appendInserts(insert.clientId)
    }
  }
  for (const id of hostIds) {
    for (const insert of byBefore.get(id) ?? []) {
      ids.push(insert.clientId)
      appendInserts(insert.clientId)
    }
    if (!omitHosts.has(id)) ids.push(id)
    appendInserts(id)
  }
  return ids
}

export function flowParagraphIds(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
): string[] {
  return flowIds(
    (documentStory(model)?.paragraphs ?? []).map((paragraph) => paragraph.id),
    inserts,
    new Set(deletedParagraphIds),
  )
}

export function storyFlowParagraphIds(
  story: { paragraphs: readonly { id: string }[] } | undefined,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
): string[] {
  return flowIds(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.id),
    inserts,
    new Set(deletedParagraphIds),
  )
}

export function resolveInsertAnchor(
  insert: LocalInsert,
  insertById: ReadonlyMap<string, LocalInsert>,
  realIds: ReadonlySet<string>,
): string {
  const start = insert.beforeParagraphId ?? insert.afterParagraphId
  let id = start
  const seen = new Set<string>()
  while (!realIds.has(id)) {
    if (seen.has(id)) return start
    seen.add(id)
    const parent = insertById.get(id)
    if (!parent) return start
    id = parent.beforeParagraphId ?? parent.afterParagraphId
  }
  return id
}

export function storyBodyParagraphIds(story: DocumentStoryWire): Set<string> {
  const hosted = new Set<string>()
  for (const paragraph of story.paragraphs) {
    for (const xml of paragraphAnchorXml(paragraph)) {
      const spec = drawingFloat(xml, paragraph.id)
      if (!spec) continue
      for (const id of spec.textBoxParaIds) hosted.add(id)
    }
  }
  const body = new Set<string>()
  for (const block of storyBlocks(story)) {
    if (block.type !== 'paragraph') continue
    if (hosted.has(block.paragraph.id)) continue
    body.add(block.paragraph.id)
  }
  return body
}

export function editingStoryOfFlowId(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  id: string,
): DocumentStoryWire | undefined {
  const insert = inserts.find((item) => item.clientId === id)
  if (!insert) return editableStoryOf(model, id)
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const realIds = new Set(
    editableParagraphs(model).map((paragraph) => paragraph.id),
  )
  return editableStoryOf(
    model,
    resolveInsertAnchor(insert, insertById, realIds),
  )
}

export function storyFlowOrder(
  model: DocumentModelWire,
  inserts: readonly LocalInsert[],
  deletedParagraphIds: readonly string[],
  paragraphId: string,
): string[] {
  return storyFlowParagraphIds(
    editingStoryOfFlowId(model, inserts, paragraphId) ?? documentStory(model),
    inserts,
    deletedParagraphIds,
  )
}
