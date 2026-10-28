import { Link, useRouterState } from '@tanstack/react-router'
import type { VerificationRun } from '@obiter/contracts'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { cn, ObiterMark } from '@obiter/ui'
import { useState, type Ref } from 'react'
import { useMattersList, type MatterRecord } from './matters'
import {
  MODULES,
  matterIdFromPath,
  resolveSection,
  type ModuleId,
} from './navigation'
import {
  redactionRunNeedsDecision,
  useRedactionRunsList,
  type RedactionRunListItem,
} from './redaction-runs'
import { MatterRow, ModuleRow } from './sidebar-rows'
import { useMediaQuery } from './use-media-query'
import type { VerificationRunSummary } from '@obiter/contracts'
import { useOrganisationVerificationRuns } from './verification-runs'

const COLLAPSE_STORAGE_KEY = 'obiter.sidebar.collapsed'
/**
 * At 1024 the sidebar is the labelled column the mock-ups show. Below that the
 * mock-ups hide it outright, which would leave a narrow window with no
 * navigation at all, so it becomes the compact icon rail instead.
 */
const NARROW_QUERY = '(max-width: 1023px)'
const RECENT_MATTERS_LIMIT = 4

/** Runs a person still has to decide, by the rule `redaction-runs` owns, so the
 * sidebar count and the Home queue never disagree about what is pending. */
export function redactionAttentionCount(
  runs: Array<Pick<RedactionRunListItem, 'status' | 'summary'>>,
): number {
  return runs.filter(redactionRunNeedsDecision).length
}

/**
 * Findings from completed Verify runs that nobody has resolved yet. A check
 * that did not run is unfinished work too, so it counts here even though the
 * run summary reports it apart from a check that ran and could not conclude.
 */
export function verificationAttentionCount(runs: VerificationRun[]): number {
  return runs
    .filter((run) => run.status === 'completed')
    .reduce(
      (total, run) =>
        total +
        run.summary.flaggedCount +
        run.summary.reviewRequiredCount +
        run.summary.notCheckedCount,
      0,
    )
}

/**
 * The tone of one run's waiting findings, by the rule Verify uses: a flagged
 * finding outranks one that needs review, and a check that did not run is still
 * unfinished work rather than a pass.
 */
function verificationAttentionToneFor(summary: VerificationRunSummary) {
  if (summary.flaggedCount > 0) return 'danger' as const
  if (summary.reviewRequiredCount > 0 || summary.notCheckedCount > 0)
    return 'warning' as const
  return 'success' as const
}

/**
 * How serious the waiting work is, so the sidebar never shows a softer colour
 * than the page it leads to.
 */
export function verificationAttentionTone(
  runs: VerificationRun[],
): 'danger' | 'warning' | 'success' {
  const tones = runs
    .filter((run) => run.status === 'completed')
    .map((run) => verificationAttentionToneFor(run.summary))
  if (tones.includes('danger')) return 'danger'
  if (tones.includes('warning')) return 'warning'
  return 'success'
}

/**
 * Most recently updated matters. The mock-up pins matters, but there is no pin
 * store yet, so the section shows recent matters and says so.
 */
export function recentMatters(matters: MatterRecord[]): MatterRecord[] {
  return [...matters]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, RECENT_MATTERS_LIMIT)
}

function readStoredCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true'
}

export function Sidebar({
  orgName,
  agentOpen,
  onToggleAgent,
  agentTriggerRef,
}: {
  orgName?: string | null
  agentOpen: boolean
  onToggleAgent: () => void
  agentTriggerRef?: Ref<HTMLButtonElement>
}) {
  const narrow = useMediaQuery(NARROW_QUERY)
  const [chosenCollapsed, setChosenCollapsed] = useState(readStoredCollapsed)
  const collapsed = narrow || chosenCollapsed
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(currentPath)
  const currentMatterId = matterIdFromPath(currentPath)

  const matters = useMattersList().data ?? []
  const runs = useRedactionRunsList().data?.runs ?? []
  const verificationRuns = useOrganisationVerificationRuns(true).runs

  // Modules without a cheap source of truth show no count rather than a zero.
  const counts = new Map<ModuleId, number>([
    ['matters', matters.filter((matter) => matter.status === 'active').length],
    ['verify', verificationAttentionCount(verificationRuns)],
    ['redact', redactionAttentionCount(runs)],
  ])
  const verifyTone = verificationAttentionTone(verificationRuns)
  const recent = recentMatters(matters)

  function toggleCollapsed() {
    const next = !chosenCollapsed
    window.localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
    setChosenCollapsed(next)
  }

  return (
    <aside
      id="app-sidebar"
      aria-label="Workspace"
      className={cn(
        'flex min-h-0 shrink-0 flex-col bg-surface',
        'transition-[width] duration-150 ease-out motion-reduce:transition-none',
        collapsed ? 'w-16' : 'w-[252px]',
      )}
    >
      <div
        className={cn(
          'flex h-12 shrink-0 items-center gap-3',
          collapsed ? 'justify-center px-0' : 'px-4',
        )}
      >
        <Link
          to="/"
          aria-label="Obiter home"
          className="flex size-7 shrink-0 items-center justify-center rounded-md"
        >
          <ObiterMark className="size-6" title="" />
        </Link>
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="truncate text-item font-normal text-ink">Obiter</p>
            {orgName ? (
              <p className="truncate text-caption text-subtle">{orgName}</p>
            ) : null}
          </div>
        )}
      </div>

      <nav
        aria-label="Workspace"
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto',
          collapsed ? 'py-3' : 'px-2 pt-3 pb-4',
        )}
      >
        <ul className="flex flex-col gap-px">
          {MODULES.map((module) => (
            <li key={module.id}>
              <ModuleRow
                label={module.label}
                to={module.to}
                icon={module.icon}
                count={counts.get(module.id)}
                alertTone={module.id === 'verify' ? verifyTone : undefined}
                current={section === module.id}
                collapsed={collapsed}
                onClick={module.id === 'agent' ? onToggleAgent : undefined}
                expanded={module.id === 'agent' ? agentOpen : undefined}
                actionRef={module.id === 'agent' ? agentTriggerRef : undefined}
              />
            </li>
          ))}
        </ul>

        {recent.length > 0 ? (
          <div
            className={cn('flex flex-col', collapsed ? 'mt-4' : 'mt-6 gap-1')}
          >
            {collapsed ? (
              <div className="mx-auto mb-2 w-5 border-t border-line" />
            ) : (
              <p className="px-3 pt-2 pb-1 text-caption text-subtle">
                Recent matters
              </p>
            )}
            <ul className="flex flex-col">
              {recent.map((matter) => (
                <li key={matter.id}>
                  <MatterRow
                    matter={matter}
                    current={matter.id === currentMatterId}
                    collapsed={collapsed}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      {narrow ? null : (
        <div className={cn('shrink-0 pb-3', collapsed ? 'px-0' : 'px-3')}>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggleCollapsed}
            className={cn(
              'flex h-8 items-center gap-3 rounded-md text-meta text-subtle',
              'transition-colors duration-150 hover:bg-hover hover:text-ink',
              collapsed ? 'mx-auto w-10 justify-center' : 'w-full px-2',
            )}
          >
            {collapsed ? (
              <CaretRight size={16} aria-hidden className="shrink-0" />
            ) : (
              <CaretLeft size={16} aria-hidden className="shrink-0" />
            )}
            {collapsed ? null : <span>Collapse sidebar</span>}
          </button>
        </div>
      )}
    </aside>
  )
}
