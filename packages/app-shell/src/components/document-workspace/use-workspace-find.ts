import { useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  clampFindIndex,
  findInDocument,
  nextFindIndex,
  previousFindIndex,
} from '../../document-find'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

/**
 * The find/replace state for the document workspace. It derives its hits from
 * the same draft state the edits do, so a hit set can never address text that
 * is no longer there, and it places the caret through the workspace's own
 * explicit placement rather than a second caret owner.
 */
export function useWorkspaceFind({
  model,
  drafts,
  onPlaceCaret,
}: {
  model: DocumentModelWire | undefined
  drafts: WorkspaceDrafts
  onPlaceCaret: (paragraphId: string, offset?: number) => void
}) {
  const [findQuery, setFindQueryState] = useState('')
  const [replaceQuery, setReplaceQuery] = useState('')
  const [findIndex, setFindIndex] = useState(-1)

  const findHits = model
    ? findInDocument(
        model,
        drafts.drafts,
        drafts.inserts,
        drafts.deletedParagraphIds,
        drafts.extraRuns,
        findQuery,
      )
    : []
  // Clamp the stored index to the current hit set so edits that shrink the
  // hits cannot leave the label or navigation on a stale position.
  const activeFindIndex = clampFindIndex(findIndex, findHits.length)

  function setFindQuery(query: string) {
    setFindQueryState(query)
    setFindIndex(-1)
  }

  function jumpToHit(index: number) {
    const hit = findHits[index]
    if (!hit) return
    setFindIndex(index)
    onPlaceCaret(hit.paragraphId, hit.start)
  }

  function replaceCurrentHit() {
    if (!model || findHits.length === 0) return
    const index = activeFindIndex < 0 ? 0 : activeFindIndex
    const caret = drafts.replaceHits(model, findHits, replaceQuery, index)
    if (caret) onPlaceCaret(caret.paragraphId, caret.offset)
  }

  function replaceAllHits() {
    if (!model || findHits.length === 0) return
    const caret = drafts.replaceHits(model, findHits, replaceQuery, 'all')
    if (caret) onPlaceCaret(caret.paragraphId, caret.offset)
  }

  return {
    findQuery,
    setFindQuery,
    replaceQuery,
    setReplaceQuery,
    findHits,
    activeFindIndex,
    onNextHit: () => jumpToHit(nextFindIndex(findHits, activeFindIndex)),
    onPreviousHit: () =>
      jumpToHit(previousFindIndex(findHits, activeFindIndex)),
    onReplaceOne: replaceCurrentHit,
    onReplaceAll: replaceAllHits,
  }
}
