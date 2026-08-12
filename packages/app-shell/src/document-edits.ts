import type {
  DocumentEditOperation,
  DocumentModelWire,
} from '@obiter/contracts'
import { documentStory, paragraphPlainText } from './document-model-text'

export type LocalInsert = {
  clientId: string
  afterParagraphId: string
  text: string
}

export function collectEditOperations(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  const story = documentStory(model)
  const deleted = new Set(deletedParagraphIds)

  for (const paragraph of story?.paragraphs ?? []) {
    if (deleted.has(paragraph.id)) continue
    for (const run of paragraph.runs) {
      const draft = drafts[run.id]
      if (draft !== undefined && draft !== run.text) {
        operations.push({
          type: 'replace_run_text',
          runId: run.id,
          text: draft,
        })
      }
    }
  }

  for (const insert of inserts) {
    operations.push({
      type: 'insert_paragraph_after',
      paragraphId: insert.afterParagraphId,
      text: insert.text,
    })
  }

  for (const paragraphId of deletedParagraphIds) {
    operations.push({ type: 'delete_paragraph', paragraphId })
  }

  return operations
}

export function isDraftDirty(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  inserts: LocalInsert[],
  deletedParagraphIds: string[],
) {
  return (
    collectEditOperations(model, drafts, inserts, deletedParagraphIds).length >
    0
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
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${filename.replace(/\.[^.]+$/u, '')}.txt`
  anchor.click()
  URL.revokeObjectURL(url)
}
