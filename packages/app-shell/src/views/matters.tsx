import { useQueries } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import type { AppPlatform } from '@obiter/contracts'
import {
  Button,
  Card,
  CardFoot,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Skeleton,
  cn,
} from '@obiter/ui'
import { useState } from 'react'
import { matterDocumentsQueryOptions } from '../documents'
import { formatDateTime } from '../format'
import { useMattersList } from '../matters'
import { useRedactionRunsList } from '../redaction-runs'
import { PageScaffold } from '../page-scaffold'
import { useOrganisationVerificationRuns } from '../verification-runs'
import { buildAttentionItems } from './home-attention'
import { CreateMatterDialog } from './create-matter-dialog'
import { MatterPreview } from './matters-preview'
import {
  buildMatterRows,
  filterMatterRows,
  legalDomainOptions,
  openWorkByMatter,
  type MatterFilter,
} from './matters-rows'
import { MattersTable } from './matters-table'

/**
 * Matters — every matter in the organisation, most recently active first, with
 * the selected matter beside the table. Every column comes from a read the
 * shell already makes: the matter record, its documents, and the same attention
 * items Home ranks, so open work means one thing everywhere.
 */
export function MattersRouteView({
  platform: _platform,
}: {
  platform: AppPlatform
}) {
  const matters = useMattersList()
  const redactionRuns = useRedactionRunsList()
  const verification = useOrganisationVerificationRuns(true)
  const [search, setSearch] = useState('')
  const [domain, setDomain] = useState<string | null>(null)
  const [needsAttention, setNeedsAttention] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = matters.data ?? []
  const documentQueries = useQueries({
    queries: list.map((matter) => ({
      ...matterDocumentsQueryOptions(matter.id),
      staleTime: 30_000,
    })),
  })
  const documentsByMatter = new Map(
    list.map((matter, index) => [matter.id, documentQueries[index]?.data]),
  )
  const attentionReady = verification.isSuccess && redactionRuns.isSuccess
  const attentionFailed = verification.isError || redactionRuns.isError
  // Filenames for the queue's rows come from the same document reads the table
  // uses, so a run names its document instead of calling it "document".
  const documentFilenames = new Map<string, string>()
  for (const documents of documentsByMatter.values()) {
    for (const document of documents ?? []) {
      const version = document.currentVersion
      if (version) documentFilenames.set(document.id, version.filename)
    }
  }
  const openWork = openWorkByMatter(
    buildAttentionItems({
      verificationRuns: verification.runs,
      redactionRuns: redactionRuns.data?.runs ?? [],
      documentFilenames,
      matters: new Map(
        list.map((matter) => [
          matter.id,
          { name: matter.name, clientReference: matter.clientReference },
        ]),
      ),
    }),
  )

  const rows = buildMatterRows({
    matters: list,
    documentsByMatter,
    openWork: attentionReady ? openWork : null,
  })
  const filter: MatterFilter = { search, domain, needsAttention }
  const visible = filterMatterRows(rows, filter)
  const selected =
    visible.find((row) => row.matter.id === selectedId) ?? visible[0] ?? null
  const domains = legalDomainOptions(list)
  // Four chips fit a 1440px row beside the search box; the rest would run to the
  // edge, so they fold into one menu. A selected domain always stays a chip.
  const VISIBLE_DOMAIN_CHIPS = 4
  const visibleDomains = domains.slice(0, VISIBLE_DOMAIN_CHIPS)
  if (domain && !visibleDomains.includes(domain)) visibleDomains.unshift(domain)
  const foldedDomains = domains.filter(
    (option) => !visibleDomains.includes(option),
  )
  const withOpenWork = rows.filter((row) => (row.openWork?.total ?? 0) > 0)

  function select(matterId: string) {
    setSelectedId(matterId)
    // The preview sits after the table below 1181px, so a selection must be
    // brought into view rather than silently changing something off screen.
    requestAnimationFrame(() => {
      document
        .getElementById('matter-preview')
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  }

  return (
    <PageScaffold
      title="Matters"
      description={
        rows.length === 0
          ? 'No matters yet.'
          : `${rows.length} ${rows.length === 1 ? 'matter' : 'matters'}, most recently active first. ${
              withOpenWork.length === 0
                ? 'None has'
                : `${withOpenWork.length} ${withOpenWork.length === 1 ? 'has' : 'have'}`
            } open work.`
      }
      actions={
        rows.length > 0 ? (
          <CreateMatterDialog trigger="New matter" size="md" />
        ) : undefined
      }
    >
      {matters.isPending ? (
        <Card aria-busy="true" className="flex flex-col gap-4 p-6">
          <Skeleton className="h-10" />
          <Skeleton className="h-64" />
          <span className="sr-only">Loading matters…</span>
        </Card>
      ) : matters.isError ? (
        <EmptyState
          title="Couldn’t load matters"
          body="Check your connection and try again."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No matters yet"
          body="A matter holds the documents, checks and sources for one client instruction. Create one when a client instructs you."
          action={<CreateMatterDialog trigger="Create the first matter" />}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-control items-center gap-2 rounded-sm border border-line bg-surface pr-3 pl-3 text-subtle focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <MagnifyingGlass size={14} aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search matters"
                aria-label="Search matters"
                className="h-full w-56 bg-transparent text-meta text-ink outline-none placeholder:text-subtle"
              />
            </label>
            <FilterChip
              label="All matters"
              count={rows.length}
              active={!needsAttention && domain === null}
              onClick={() => {
                setNeedsAttention(false)
                setDomain(null)
              }}
            />
            <FilterChip
              label="Needs attention"
              count={withOpenWork.length}
              alert
              active={needsAttention}
              onClick={() => setNeedsAttention(true)}
            />
            {visibleDomains.map((option) => (
              <FilterChip
                key={option}
                label={option}
                active={domain === option}
                onClick={() => setDomain(option)}
              />
            ))}
            {foldedDomains.length > 0 ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button variant="secondary" size="md">
                      More ({foldedDomains.length})
                    </Button>
                  }
                />
                <MenuContent aria-label="More legal domains">
                  {foldedDomains.map((option) => (
                    <MenuItem
                      key={option}
                      onClick={() => {
                        setNeedsAttention(false)
                        setDomain(option)
                      }}
                    >
                      {option}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            ) : null}
          </div>

          <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
            <Card className="overflow-hidden">
              {visible.length === 0 ? (
                <div className="px-6 py-8">
                  <p className="text-body text-muted">
                    No matter matches these filters.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => {
                      setSearch('')
                      setDomain(null)
                      setNeedsAttention(false)
                    }}
                  >
                    Clear filters
                  </Button>
                </div>
              ) : (
                <MattersTable
                  rows={visible}
                  selectedId={selected?.matter.id ?? null}
                  onSelect={select}
                  openWorkUnavailable={attentionFailed}
                />
              )}
              <CardFoot>
                <span>
                  <span className="text-ink">{rows.length}</span>{' '}
                  {rows.length === 1 ? 'matter' : 'matters'} ·{' '}
                  <span className="text-ink">{withOpenWork.length}</span> with
                  open work
                </span>
                <span>
                  {rows[0]
                    ? `Updated ${formatDateTime(rows[0].lastActivity)}`
                    : null}
                </span>
              </CardFoot>
            </Card>

            {selected ? (
              <Card id="matter-preview">
                <MatterPreview
                  row={selected}
                  documents={documentsByMatter.get(selected.matter.id)}
                />
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </PageScaffold>
  )
}

function FilterChip({
  label,
  count,
  active,
  alert,
  onClick,
}: {
  label: string
  count?: number
  /** Waiting work, in the warning colour the mock-up gives this chip. */
  alert?: boolean
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-control-compact items-center gap-2 rounded-sm px-3 text-meta whitespace-nowrap',
        active
          ? 'bg-brand-soft text-ink'
          : 'bg-fill text-muted hover:bg-fill-hover hover:text-ink',
      )}
    >
      {label}
      {count === undefined ? null : (
        <span
          className={cn(
            'text-caption tabular-nums',
            alert && count > 0 ? 'text-danger' : null,
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}
