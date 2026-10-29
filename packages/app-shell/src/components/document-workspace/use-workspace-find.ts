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
  onRefused: (refusal: SelectionRefusal) => void
  story?: DocumentStoryWire
}) {
  const { query, options, index: findIndex, toolbar } = useFindState()
  const [replaceText, onReplace] = useState('')

  const findHits = useMemo(
    () => findInDocument(model, drafts.state, query, story, options),
    [model, drafts.state, query, story, options],
  )
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
