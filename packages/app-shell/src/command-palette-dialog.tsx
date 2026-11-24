import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { currentUserQueryOptions } from './current-user'
import { documentIdFromPath, matterIdFromPath } from './navigation'
import { SETTINGS_SECTIONS, type SettingsSectionId } from './settings-sections'
import { useAppTheme } from './use-app-theme'
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
          search={target.verify ? { verify: target.verify } : undefined}
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

function useActionRows(currentMatterId: string | null): PaletteRow[] {
  const { data: me } = useQuery(currentUserQueryOptions())
  const theme = useAppTheme()

  function settingRow(id: SettingsSectionId, label: string): PaletteRow {
    const targets = {
      account: 'settings-account',
      security: 'settings-security',
      organisation: 'settings-organisation',
      preferences: 'settings-preferences',
      members: 'settings-members',
      integrations: 'settings-integrations',
      agent: 'settings-agent',
    } satisfies Record<SettingsSectionId, PaletteActionId>
    return {
      id: `action-settings-${id}`,
      label: `Open ${label.toLowerCase()} settings`,
      hint: 'Settings',
      target: { kind: 'action', id: targets[id] },
    }
  }

  return [
    {
      id: 'send-feedback',
      label: 'Send feedback',
      target: { kind: 'action', id: 'send-feedback' },
    },
    {
      id: 'action-toggle-nav',
      label: 'Toggle sidebar',
      hint: 'Show or hide the navigation',
      shortcut: 'toggle-nav',
      target: { kind: 'action', id: 'toggle-nav' },
    },
    {
      id: 'action-toggle-right-slot',
      label: currentMatterId ? 'Toggle agent panel' : 'Open Agent',
      hint: currentMatterId
        ? 'Show or hide the matter agent'
        : 'Research case law and legislation',
      shortcut: 'toggle-right-slot',
      target: { kind: 'action', id: 'toggle-right-slot' },
    },
    {
      id: 'action-focus-mode',
      label: 'Focus mode',
      hint: 'Hide the sidebar, contents and panel',
      shortcut: 'focus-mode',
      target: { kind: 'action', id: 'focus-mode' },
    },
    {
      id: 'action-toggle-theme',
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      hint: 'Change how Obiter looks',
      target: { kind: 'action', id: 'toggle-theme' },
    },
    {
      id: 'action-layout-sidebar',
      label: 'Switch to sidebar layout',
      hint: 'Navigation beside the page',
      target: { kind: 'action', id: 'layout-sidebar' },
    },
    {
      id: 'action-layout-tabs',
      label: 'Switch to tabs layout',
      hint: 'Modules in the title bar',
      target: { kind: 'action', id: 'layout-tabs' },
    },
    {
      id: 'action-layout-clean',
      label: 'Switch to clean layout',
      hint: 'Navigation behind the Obiter mark',
      target: { kind: 'action', id: 'layout-clean' },
    },
    ...SETTINGS_SECTIONS.filter((section) => !me || section.available(me)).map(
      (section) => settingRow(section.id, section.label),
    ),
  ]
}

export function CommandPaletteDialog({
  onClose,
  onAction,
  onCreate,
}: {
  onClose: () => void
  onAction: (id: PaletteActionId) => void
  onCreate: (id: PaletteCreateId, matterId?: string) => void
}) {
  const isMac = useIsMacPlatform()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [pickFor, setPickFor] = useState<PaletteCreateId | null>(null)

  const matters = useMattersList().data ?? []
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const currentMatterId = matterIdFromPath(pathname)
  const currentDocumentId = documentIdFromPath(pathname)
  const currentMatterName =
    matters.find((matter) => matter.id === currentMatterId)?.name ?? null
  const actions = useActionRows(currentMatterId)
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
        actions: [
          ...actions,
          ...(currentDocumentId && currentMatterId
            ? [
                {
                  id: 'run-verify',
                  label: 'Run Verify',
                  hint: 'Run Verify on the open document',
                  target: {
                    kind: 'document',
                    matterId: currentMatterId,
                    documentId: currentDocumentId,
                    verify: 'run',
                  },
                } satisfies PaletteRow,
              ]
            : []),
          {
            id: 'welcome-guide',
            label: 'Show welcome guide',
            target: { kind: 'action', id: 'welcome-guide' },
          },
        ],
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
