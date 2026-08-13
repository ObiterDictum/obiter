import { useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import { removeInsert, type LocalInsert } from '../../document-edits'
import {
  popWorkspaceDraft,
  pushWorkspaceDraft,
  type WorkspaceDraftSnapshot,
} from '../../document-editor-history'
import {
  emptyFormatDrafts,
  type FormatDrafts,
} from '../../document-format-edits'
import {
  applyWordEdit,
  type EditorResult,
  type ExtraRuns,
} from '../../document-word-edits'
import type { ParagraphWordEdit } from './model-paragraph'

export function useWorkspaceDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [inserts, setInserts] = useState<LocalInsert[]>([])
  const [deletedParagraphIds, setDeletedParagraphIds] = useState<string[]>([])
  const [extraRuns, setExtraRuns] = useState<ExtraRuns>({})
  const [format, setFormatState] = useState<FormatDrafts>(emptyFormatDrafts)
  const [past, setPast] = useState<WorkspaceDraftSnapshot[]>([])

  function snapshot(): WorkspaceDraftSnapshot {
    return { drafts, inserts, deletedParagraphIds, extraRuns, format }
  }

  function checkpoint() {
    setPast((current) => pushWorkspaceDraft(current, snapshot()))
  }

  function resetDrafts() {
    setDrafts({})
    setInserts([])
    setDeletedParagraphIds([])
    setExtraRuns({})
    setFormatState(emptyFormatDrafts)
    setPast([])
  }

  function undoDraft() {
    const popped = popWorkspaceDraft(past)
    if (!popped) return
    setPast(popped.history)
    setDrafts(popped.snapshot.drafts)
    setInserts(popped.snapshot.inserts)
    setDeletedParagraphIds(popped.snapshot.deletedParagraphIds)
    setExtraRuns(popped.snapshot.extraRuns)
    setFormatState(popped.snapshot.format)
  }

  function commitEditor(result: EditorResult) {
    setDrafts(result.state.drafts)
    setInserts(result.state.inserts)
    setDeletedParagraphIds(result.state.deletedParagraphIds)
    setExtraRuns(result.state.extraRuns)
  }

  function handleWordEdit(
    model: DocumentModelWire,
    edit: ParagraphWordEdit,
  ): { paragraphId: string; offset: number } | null {
    const result = applyWordEdit(
      model,
      { drafts, inserts, deletedParagraphIds, extraRuns },
      edit,
      crypto.randomUUID(),
    )
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function insertAfter(afterParagraphId: string) {
    checkpoint()
    const clientId = crypto.randomUUID()
    setInserts((current) => [
      ...current,
      { clientId, afterParagraphId, text: '' },
    ])
    return clientId
  }

  function deleteParagraph(paragraphId: string) {
    checkpoint()
    const removed = removeInsert(inserts, paragraphId)
    if (removed) {
      setInserts(removed.inserts)
      return removed.selectId
    }
    setDeletedParagraphIds((current) =>
      current.includes(paragraphId) ? current : [...current, paragraphId],
    )
    return null
  }

  function setFormat(update: (current: FormatDrafts) => FormatDrafts) {
    checkpoint()
    setFormatState(update)
  }

  return {
    drafts,
    inserts,
    deletedParagraphIds,
    extraRuns,
    format,
    setDrafts,
    setInserts,
    setFormat,
    resetDrafts,
    undoDraft,
    handleWordEdit,
    insertAfter,
    deleteParagraph,
    canUndo: past.length > 0,
  }
}
