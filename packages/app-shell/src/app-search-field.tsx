import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Folders,
  MagnifyingGlass,
  PencilSimple,
  X,
} from '@phosphor-icons/react'
import { KeyboardHint, cn } from '@obiter/ui'
import { useMattersList } from './matters'
import { useRedactionRunsList } from './redaction-runs'

type AppSearchHit =
  | { kind: 'mode'; id: string; label: string; hint: string; to: string }
  | { kind: 'matter'; id: string; label: string; hint: string; to: string }
  | { kind: 'redact'; id: string; label: string; hint: string; to: string }
  | {
      kind: 'judgments'
      id: string
      label: string
      hint: string
      judgmentsQuery: string
    }

const MODE_HITS: AppSearchHit[] = [
  {
    kind: 'mode',
    id: 'mode-search',
    label: 'Search',
    hint: 'Judgments and legislation',
    to: '/search',
  },
  {
    kind: 'mode',
    id: 'mode-matters',
    label: 'Matters',
    hint: 'Matter workspace',
    to: '/matters',
  },
  {
    kind: 'mode',
    id: 'mode-redact',
    label: 'Redact',
    hint: 'Redaction runs',
    to: '/redact',
  },
  {
    kind: 'mode',
    id: 'mode-verify',
    label: 'Verify',
    hint: 'Citation, authority and quote checks',
    to: '/verify',
  },
]

/**
 * App-wide top-bar search. Types in the compact field; when the query no longer
 * fits, a floating expanded composer opens directly below.
 */
export function AppSearchField() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const floatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const [openedExpanded, setOpenedExpanded] = useState(false)
  const mattersQuery = useMattersList()
  const runsQuery = useRedactionRunsList()

  const expanded = focused && (openedExpanded || overflows)

  const measureOverflow = useEffectEvent(() => {
    const input = inputRef.current
    if (!input) return
    const next = input.scrollWidth > input.clientWidth + 1
    setOverflows(next)
    if (next && focused) setOpenedExpanded(true)
  })

  useEffect(() => {
    measureOverflow()
  }, [query, measureOverflow])

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key !== 'k') return
      event.preventDefault()
      if (expanded) {
        floatInputRef.current?.focus()
        return
      }
      // The compact field has no box at narrow widths, so the shortcut opens the
      // composer there instead of focusing an invisible input.
      if (!inputRef.current || inputRef.current.offsetParent === null) {
        setFocused(true)
        setOpenedExpanded(true)
        return
      }
      inputRef.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  useEffect(() => {
    if (!expanded) return
    floatInputRef.current?.focus()
    const value = floatInputRef.current?.value ?? ''
    floatInputRef.current?.setSelectionRange(value.length, value.length)
  }, [expanded])

  useEffect(() => {
    if (!focused) return
    function onPointerDown(event: MouseEvent) {
      if (
        !(event.target instanceof Node) ||
        !shellRef.current?.contains(event.target)
      ) {
        setFocused(false)
        setOpenedExpanded(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [focused])

  const hits = buildHits(
    query,
    mattersQuery.data ?? [],
    runsQuery.data?.runs ?? [],
  )

  function goRoute(to: string) {
    setFocused(false)
    setOpenedExpanded(false)
    void navigate({ to })
  }

  function goJudgments(judgmentsQuery: string) {
    setFocused(false)
    setOpenedExpanded(false)
    if (typeof window !== 'undefined' && judgmentsQuery.trim()) {
      window.sessionStorage.setItem(
        'obiter.search.initialQuery',
        judgmentsQuery.trim(),
      )
    }
    void navigate({ to: '/search' })
  }

  function activateHit(hit: AppSearchHit) {
    if (hit.kind === 'judgments') {
      goJudgments(hit.judgmentsQuery)
      return
    }
    goRoute(hit.to)
  }

  function submitPrimary() {
    if (hits[0]) {
      activateHit(hits[0])
      return
    }
    goJudgments(query)
  }

  function onCompactSubmit(event: FormEvent) {
    event.preventDefault()
    submitPrimary()
  }

  function onCompactKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setFocused(false)
      setOpenedExpanded(false)
      inputRef.current?.blur()
    }
  }

  function onFloatKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      setFocused(false)
      setOpenedExpanded(false)
      inputRef.current?.blur()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submitPrimary()
    }
  }

  return (
    <div
      ref={shellRef}
      className="relative w-[min(300px,32vw)] shrink-0 max-compact:w-8"
    >
      <form
        className={cn(
          'flex h-[30px] items-center gap-2 rounded-md border border-line bg-surface pr-1 pl-3',
          'transition-[border-color,box-shadow] duration-150 ease-out',
          'hover:border-line-strong',
          // Keyboard focus must be visible on the field itself, not only as a
          // border colour change. `has-[:focus-visible]` keeps the ring on the
          // box that is the field's visual, matching the Button convention.
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
          // At 1024 and below search is an icon: a 240px field would squeeze the
          // breadcrumb into an ellipsis.
          'max-compact:w-8 max-compact:justify-center max-compact:border-0 max-compact:bg-transparent max-compact:pr-0 max-compact:pl-0',
          focused && 'border-line-strong',
        )}
        onSubmit={onCompactSubmit}
      >
        {/* Narrow widths have no room for a field, so a real button opens the
            same composer the field would. */}
        <button
          type="button"
          aria-label="Search Obiter"
          onClick={() => {
            setFocused(true)
            setOpenedExpanded(true)
          }}
          className="absolute inset-0 hidden rounded-md hover:bg-hover max-compact:block"
        />
        <MagnifyingGlass
          size={16}
          className="shrink-0 text-subtle"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onCompactKeyDown}
          placeholder="Search Obiter"
          aria-label="Search Obiter"
          readOnly={expanded}
          onClick={() => {
            if (expanded) floatInputRef.current?.focus()
          }}
          className="min-w-0 flex-1 bg-transparent text-meta text-ink outline-none placeholder:text-subtle max-compact:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            className="rounded-sm p-1 text-subtle hover:text-ink max-compact:hidden"
            onClick={() => {
              setQuery('')
              setOpenedExpanded(false)
              inputRef.current?.focus()
            }}
          >
            <X size={12} aria-hidden />
          </button>
        ) : (
          <KeyboardHint className="max-compact:hidden">
            {modKeyLabel()}K
          </KeyboardHint>
        )}
      </form>

      {expanded ? (
        <div
          // Fixed and centred on the viewport: the compact field now sits at the
          // right of the bar, so anchoring the panel to the field pushed it past
          // a 768px viewport. The width already caps to `100vw - 2rem`.
          className="fixed top-12 left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2"
          role="dialog"
          aria-label="Expanded search"
        >
          <div
            className={cn(
              'overflow-hidden rounded-lg border border-line bg-raised shadow-lg',
              'origin-top transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            )}
          >
            <div className="flex items-start gap-3 border-b border-line px-4 py-3">
              <MagnifyingGlass
                size={16}
                className="mt-1 shrink-0 text-subtle"
                aria-hidden
              />
              <textarea
                ref={floatInputRef}
                value={query}
                rows={2}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onFloatKeyDown}
                placeholder="Search matters, redactions and judgments"
                aria-label="Expanded search"
                className="max-h-40 min-h-[3rem] flex-1 resize-none bg-transparent text-body text-ink outline-none placeholder:text-subtle"
              />
              <button
                type="button"
                aria-label="Close expanded search"
                className="mt-0.5 rounded-md p-1 text-subtle hover:bg-hover hover:text-ink"
                onClick={() => {
                  setFocused(false)
                  setOpenedExpanded(false)
                }}
              >
                <X size={14} aria-hidden />
              </button>
            </div>

            <div className="max-h-72 overflow-y-auto p-2">
              {hits.length === 0 ? (
                <p className="px-3 py-4 text-meta text-muted">
                  Type to search the app, or press Enter to search judgments.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5" role="listbox">
                  {hits.map((hit, index) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === 0}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors duration-150',
                          index === 0
                            ? 'bg-brand-soft text-ink'
                            : 'text-ink hover:bg-hover',
                        )}
                        onClick={() => activateHit(hit)}
                      >
                        <HitIcon kind={hit.kind} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-item">
                            {hit.label}
                          </span>
                          <span className="block truncate text-caption text-muted">
                            {hit.hint}
                          </span>
                        </span>
                        {index === 0 ? (
                          <KeyboardHint>Enter</KeyboardHint>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function HitIcon({ kind }: { kind: AppSearchHit['kind'] }) {
  if (kind === 'matter')
    return <Folders size={16} className="shrink-0 text-subtle" aria-hidden />
  if (kind === 'redact')
    return (
      <PencilSimple size={16} className="shrink-0 text-subtle" aria-hidden />
    )
  return (
    <MagnifyingGlass size={16} className="shrink-0 text-subtle" aria-hidden />
  )
}

function modKeyLabel() {
  if (typeof navigator === 'undefined') return 'Ctrl+'
  const platform = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  const isApple = /Mac|iPhone|iPad|iPod/i.test(platform) || /Mac OS/i.test(ua)
  return isApple ? '⌘' : 'Ctrl+'
}

function buildHits(
  query: string,
  matters: Array<{ id: string; name: string }>,
  runs: Array<{ id: string; sourceFilename: string }>,
): AppSearchHit[] {
  const trimmed = query.trim().toLowerCase()
  const hits: AppSearchHit[] = []

  if (!trimmed) {
    return MODE_HITS.slice(0, 4)
  }

  for (const mode of MODE_HITS) {
    if (
      mode.label.toLowerCase().includes(trimmed) ||
      mode.hint.toLowerCase().includes(trimmed)
    ) {
      hits.push(mode)
    }
  }

  for (const matter of matters) {
    if (!matter.name.toLowerCase().includes(trimmed)) continue
    hits.push({
      kind: 'matter',
      id: `matter-${matter.id}`,
      label: matter.name,
      hint: 'Matter',
      to: `/matters/${matter.id}`,
    })
    if (hits.length >= 8) break
  }

  for (const run of runs) {
    if (!run.sourceFilename.toLowerCase().includes(trimmed)) continue
    hits.push({
      kind: 'redact',
      id: `redact-${run.id}`,
      label: run.sourceFilename,
      hint: 'Redaction run',
      to: `/redact/${run.id}`,
    })
    if (hits.length >= 10) break
  }

  hits.push({
    kind: 'judgments',
    id: 'judgments-query',
    label: `Search judgments for “${query.trim()}”`,
    hint: 'Open legal search',
    judgmentsQuery: query.trim(),
  })

  return hits.slice(0, 10)
}
