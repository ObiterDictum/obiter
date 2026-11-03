import { Link } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  KeyboardHint,
  cn,
} from '@obiter/ui'
import { MagnifyingGlass } from '@obiter/ui/icons/shell'
import { useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  buildPalette,
  flattenPalette,
  paletteScore,
  type PaletteActionId,
  type PaletteCreateId,
  type PaletteGroup,
  type PaletteMatter,
  type PaletteRow,
} from './command-palette-rows'
import { useCitationTargets, useRecentlyOpenedDocument } from './documents'
import { useMattersList } from './matters'
import { useRedactionRunsList } from './redaction-runs'
import { ShortcutHint } from './shell-shortcuts'
import { formatShortcut, useIsMacPlatform } from './keyboard-platform'
import { useOrganisationVerificationRuns } from './verification-runs'

function rowElementId(id: string) {
  return `obiter-palette-row-${id}`
}

function rowClass(active: boolean) {
  return cn(
    'flex min-h-9 w-full cursor-default items-center gap-3 rounded-lg px-3 py-1.5 text-left text-meta',
    active ? 'bg-fill text-ink' : 'text-muted hover:bg-hover hover:text-ink',
  )
}

function RowContent({ row }: { row: PaletteRow }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{row.label}</span>
        {row.hint ? (
          <span className="block truncate text-caption text-subtle">
            {row.hint}
          </span>
        ) : null}
      </span>
      {row.shortcut ? <ShortcutHint command={row.shortcut} /> : null}
    </>
  )
}

function PaletteLink({
  row,
  active,
  onSelect,
  onHover,
}: {
  row: PaletteRow
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  const shared = {
    id: rowElementId(row.id),
    role: 'option',
    'aria-selected': active,
    className: rowClass(active),
    onClick: onSelect,
    onMouseMove: onHover,
    children: <RowContent row={row} />,
  }
  const target = row.target
  switch (target.kind) {
    case 'matter':
      return (
        <Link
          to="/matters/$matterId"
          params={{ matterId: target.matterId }}
          {...shared}
        />
      )
    case 'document':
      return (
        <Link
          to="/matters/$matterId/documents/$documentId"
          params={{ matterId: target.matterId, documentId: target.documentId }}
          {...shared}
        />
      )
    case 'redaction':
      return (
        <Link
          to="/redact/$runId"
          params={{ runId: target.runId }}
          {...shared}
        />
      )
    case 'verify':
      return <Link to="/verify" {...shared} />
    case 'law':
      return <Link to="/search" search={{ q: target.query }} {...shared} />
    default:
      return null
  }
}

function PaletteRowView({
  row,
  active,
  onSelect,
  onHover,
}: {
  row: PaletteRow
  active: boolean
  onSelect: () => void
  onHover: () => void
}) {
  if (row.target.kind !== 'action' && row.target.kind !== 'create') {
    return (
      <PaletteLink
        row={row}
        active={active}
        onSelect={onSelect}
        onHover={onHover}
      />
    )
  }
  return (
    <button
      type="button"
      role="option"
      id={rowElementId(row.id)}
      aria-selected={active}
      className={rowClass(active)}
      onClick={onSelect}
      onMouseMove={onHover}
    >
      <RowContent row={row} />
    </button>
  )
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p
      aria-hidden
      className="px-2 pt-2 pb-1 text-caption tracking-wide text-subtle uppercase"
    >
      {children}
    </p>
  )
}

function matterPickGroups(
  query: string,
  matters: PaletteMatter[],
  pickFor: PaletteCreateId,
): PaletteGroup[] {
  const rows: PaletteRow[] = []
  for (const matter of matters) {
    const hint = matter.clientReference ?? 'Matter'
    if (paletteScore(matter.name, hint, query) === null) continue
    rows.push({
      id: `pick-${matter.id}`,
      label: matter.name,
      hint,
      target: { kind: 'create', id: pickFor, matterId: matter.id },
    })
  }
  return [{ id: 'go-to', label: 'Choose a matter', rows }]
}

export function CommandPaletteDialog({
  currentMatterId,
  currentMatterName,
  actions,
  onClose,
  onAction,
  onCreate,
}: {
  currentMatterId: string | null
  currentMatterName: string | null
  actions: PaletteRow[]
  onClose: () => void
  onAction: (id: PaletteActionId) => void
  onCreate: (id: PaletteCreateId, matterId?: string) => void
}) {
  const isMac = useIsMacPlatform()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickFor, setPickFor] = useState<PaletteCreateId | null>(null)

  const matters = useMattersList().data ?? []
  const documents = useCitationTargets().data ?? []
  const verificationRuns = useOrganisationVerificationRuns(true).runs
  const redactionRuns = useRedactionRunsList().data?.runs ?? []
  const recentDocument = useRecentlyOpenedDocument().data ?? null

  const groups = pickFor
    ? matterPickGroups(query, matters, pickFor)
    : buildPalette({
        query,
        matters,
        documents,
        verificationRuns,
        redactionRuns,
        recentlyOpenedDocumentId: recentDocument?.documentId ?? null,
        currentMatterName,
        actions,
      })
  const rows = flattenPalette(groups)
  const activeRow = rows[Math.min(activeIndex, Math.max(rows.length - 1, 0))]

  function activate(row: PaletteRow) {
    if (row.target.kind === 'action') {
      onAction(row.target.id)
      onClose()
      return
    }
    if (row.target.kind === 'create') {
      const needsMatter =
        row.target.id === 'upload-document' ||
        row.target.id === 'blank-document'
      const matterId = row.target.matterId ?? currentMatterId ?? undefined
      if (!needsMatter || matterId) {
        onCreate(row.target.id, matterId)
        onClose()
        return
      }
      setPickFor(row.target.id)
      setQuery('')
      setActiveIndex(0)
      return
    }
    onClose()
  }

  function moveActive(delta: number) {
    if (rows.length === 0) return
    const next = (activeIndex + delta + rows.length) % rows.length
    setActiveIndex(next)
    const row = rows[next]
    if (!row) return
    document
      .getElementById(rowElementId(row.id))
      ?.scrollIntoView({ block: 'nearest' })
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(event.key === 'ArrowDown' ? 1 : -1)
      return
    }
    if (event.key !== 'Enter') return
    event.preventDefault()
    if (!activeRow) return
    const element = document.getElementById(rowElementId(activeRow.id))
    if (!element) return
    if (
      (event.metaKey || event.ctrlKey) &&
      element instanceof HTMLAnchorElement
    ) {
      window.open(element.href, '_blank', 'noopener')
      onClose()
      return
    }
    element.click()
  }

  const empty = rows.length === 0

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent surface="palette" className="flex max-h-[70dvh] flex-col">
        <DialogTitle className="sr-only">Search Obiter</DialogTitle>
        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4">
          <MagnifyingGlass
            size={16}
            className="shrink-0 text-subtle"
            aria-hidden
          />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
              if (pickFor) setPickFor(null)
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-autocomplete="list"
            aria-controls="obiter-palette-results"
            aria-activedescendant={
              activeRow ? rowElementId(activeRow.id) : undefined
            }
            aria-label="Search Obiter"
            placeholder={
              pickFor
                ? 'Search matters'
                : 'Search matters, documents and commands'
            }
            className="h-11 min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-subtle"
          />
          <KeyboardHint>{formatShortcut(['primary', 'K'], isMac)}</KeyboardHint>
        </div>

        <div
          id="obiter-palette-results"
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto p-2"
        >
          {empty ? (
            <p className="px-2 py-4 text-meta text-muted">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.label}>
                <GroupHeading>{group.label}</GroupHeading>
                {group.rows.map((row) => (
                  <PaletteRowView
                    key={row.id}
                    row={row}
                    active={row.id === activeRow?.id}
                    onSelect={() => activate(row)}
                    onHover={() =>
                      setActiveIndex(
                        rows.findIndex((candidate) => candidate.id === row.id),
                      )
                    }
                  />
                ))}
              </div>
            ))
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2 text-caption text-subtle">
          <span className="flex items-center gap-1">
            <KeyboardHint>↑</KeyboardHint>
            <KeyboardHint>↓</KeyboardHint>
            move
          </span>
          <span className="flex items-center gap-1">
            <KeyboardHint>↵</KeyboardHint>
            open
          </span>
          <span className="flex items-center gap-1">
            <KeyboardHint>Esc</KeyboardHint>
            close
          </span>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
