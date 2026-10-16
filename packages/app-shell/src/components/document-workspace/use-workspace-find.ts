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
  const { query, options, index: findIndex, toolbar } = useFindState()
  const [replaceText, onReplace] = useState('')

  const findHits = useMemo(
    () => findInDocument(model, drafts.state, query, story, options),
    [model, drafts.state, query, story, options],
  )
  // Clamp the stored index to the current hit set so edits that shrink the
  // hits cannot leave the label or navigation on a stale position.
  const activeFindIndex = clampFindIndex(findIndex, findHits.length)

  function replace(which: number | 'all') {
    if (!model) return
    const outcome = drafts.replaceHits(
      model,
      story,
      query,
      options,
      replaceText,
      which,
    )
    if (outcome.status === 'applied') {
      onPlaceCaret(outcome.caret.paragraphId, outcome.caret.offset)
      return
    }
    // Every non-applied outcome announces through the same live region a
    // blocked selection edit uses: a refusal names its reason — structure
    // reworded for find, join-formatting already reading as an edit refusal
    // — and 'empty' means the re-derived hits found nothing left to act on.
    onRefused(
      outcome.status === 'empty'
        ? 'find-empty'
        : outcome.refusal === 'structure'
          ? 'find-structure'
          : outcome.refusal,
    )
  }

  return {
    find: {
      ...toolbar(findHits, activeFindIndex, ({ from }) =>
        onPlaceCaret(from.paragraphId, from.offset),
      ),
      replace: replaceText,
      canReplace: !!findHits.length,
      onReplace,
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
  /** Selects hit `index` and visits it: the surface decides what a jump
   * means — placing a caret or turning to a page. */
  const jumpTo = <T>(
    hits: readonly T[],
    index: number,
    visit: (hit: T) => void,
  ) => {
    const hit = hits[index]
    if (!hit) return
    setIndex(index)
    visit(hit)
  }
  return {
    query,
    options,
    index,
    onQuery,
    onToggleOption,
    /** The find controls every workspace find surface shares: the query
     * field, the match count, the match-case and whole-word toggles, and
     * previous/next navigation that selects a hit and visits it — the
     * surface decides what a jump means: placing a caret or turning to a
     * page. The replace group is a caller's addition — a read-only surface
     * stops here. */
    toolbar: <T>(
      hits: readonly T[],
      index: number,
      visit: (hit: T) => void,
    ) => ({
      query,
      options,
      onQuery,
      onToggleOption,
      matchLabel: findMatchLabel(index, hits.length),
      onNext: () => jumpTo(hits, nextFindIndex(hits, index), visit),
      onPrevious: () => jumpTo(hits, previousFindIndex(hits, index), visit),
    }),
  }
}
