import { useMemo, useState } from 'react'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import {
  clampFindIndex,
  FIND_MATCH_DEFAULTS,
  findInDocument,
  findMatchLabel,
  nextFindIndex,
  previousFindIndex,
} from '../../document-find'
import type { SelectionRefusal } from './document-selection-notices'
import type { useWorkspaceDrafts } from './use-workspace-drafts'

type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

/**
 * The find/replace state for the document workspace. It derives its hits from
 * the same draft state the edits do, so a hit set can never address text that
 * is no longer there, and it places the caret through the workspace's own
 * explicit placement rather than a second caret owner. Find and replace share
 * the one options state, so the hit the count shows is the range the replace
 * rewrites.
 */
export function useWorkspaceFind({
  model,
  drafts,
  onPlaceCaret,
  onRefused,
  story,
}: {
  model: DocumentModelWire | undefined
  drafts: WorkspaceDrafts
  onPlaceCaret: (paragraphId: string, offset?: number) => void
  /** Where a replace refusal surfaces — the same live region selection
   * refusals announce in, so a blocked replace names its reason. */
  onRefused: (refusal: SelectionRefusal) => void
  /** The story find scopes to — the story open for editing, so navigation
   * never jumps the caret into a story that is not being edited. */
  story?: DocumentStoryWire
}) {
  const { query, options, index: findIndex, jumpTo, toolbar } = useFindState()
  const [replaceQuery, setReplaceQuery] = useState('')

  const findHits = useMemo(
    () => findInDocument(model, drafts.state, query, story, options),
    [model, drafts.state, query, story, options],
  )
  // Clamp the stored index to the current hit set so edits that shrink the
  // hits cannot leave the label or navigation on a stale position.
  const activeFindIndex = clampFindIndex(findIndex, findHits.length)

  const onJump = (index: number) =>
    jumpTo(findHits, index, ({ from }) =>
      onPlaceCaret(from.paragraphId, from.offset),
    )

  function replace(which: number | 'all') {
    if (!model) return
    const outcome = drafts.replaceHits(
      model,
      story,
      query,
      options,
      replaceQuery,
      which,
    )
    if (outcome.status === 'applied') {
      onPlaceCaret(outcome.caret.paragraphId, outcome.caret.offset)
    } else if (outcome.status === 'refused') {
      // The refusal announces through the same live region a blocked
      // selection edit uses, with the structure reason reworded for find;
      // join-formatting already reads as an edit refusal.
      onRefused(
        outcome.refusal === 'structure' ? 'find-structure' : outcome.refusal,
      )
    } else {
      // 'empty': the hits were re-derived before the replace, so there was
      // nothing left to act on — say so instead of a silent no-op click.
      onRefused('find-empty')
    }
  }

  return {
    find: {
      ...toolbar(findHits, activeFindIndex, onJump),
      replace: replaceQuery,
      canReplace: !!findHits.length,
      onReplace: setReplaceQuery,
      onReplaceOne: () => replace(Math.max(activeFindIndex, 0)),
      onReplaceAll: () => replace('all'),
    },
  }
}

/**
 * The find field's own state — query, match options and the selected hit —
 * shared by the document and PDF find surfaces. Every setter that changes
 * what would match also clears the selection, so a stale index can never
 * point the count or a jump at a hit that no longer exists.
 */
export function useFindState() {
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState(FIND_MATCH_DEFAULTS)
  const [index, setIndex] = useState(-1)
  const onQuery = (next: string) => {
    setQuery(next)
    setIndex(-1)
  }
  const onToggleOption = (key: 'matchCase' | 'wholeWord') => {
    setOptions((current) => ({ ...current, [key]: !current[key] }))
    setIndex(-1)
  }
  return {
    query,
    options,
    index,
    onQuery,
    onToggleOption,
    /** Selects hit `index` and visits it: the surface decides what a jump
     * means — placing a caret or turning to a page. */
    jumpTo: <T>(hits: readonly T[], index: number, visit: (hit: T) => void) => {
      const hit = hits[index]
      if (!hit) return
      setIndex(index)
      visit(hit)
    },
    /** The find controls every workspace find surface shares: the query
     * field, the match count, the match-case and whole-word toggles, and
     * previous/next navigation that wraps through `jump` with the hit
     * list's own order. The replace group is a caller's addition — a
     * read-only surface stops here. */
    toolbar: (
      hits: readonly unknown[],
      index: number,
      onJump: (index: number) => void,
    ) => ({
      query,
      options,
      onQuery,
      onToggleOption,
      matchLabel: findMatchLabel(index, hits.length),
      onNext: () => onJump(nextFindIndex(hits, index)),
      onPrevious: () => onJump(previousFindIndex(hits, index)),
    }),
  }
}
