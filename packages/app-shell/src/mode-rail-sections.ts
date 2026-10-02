import type { useNavigate } from '@tanstack/react-router'
import type { VerificationRun } from '@obiter/contracts'
import {
  BookmarkSimple,
  Clock,
  FileText,
  Folders,
  House,
  ListChecks,
  MagnifyingGlass,
  PencilSimple,
  WarningCircle,
} from '@phosphor-icons/react'
import { useMatterDocuments } from './documents'
import { useMattersList } from './matters'
import type { ModeId, PhosphorIcon } from './mode-navigation'
import { isAttentionRun, useRedactionRunsList } from './redaction-runs'
import { getRecentLegalSearches } from './legal-search-recents'
import {
  verificationOutcomeLabel,
  verificationRunStatusLabel,
} from './verification-copy'
import { useOrganisationVerificationRuns } from './verification-runs'

export type RailItem = {
  id: string
  label: string
  icon: PhosphorIcon
  to?: string
  note?: string
  onClick?: () => void
  muted?: boolean
}

export type RailSection = {
  title: string
  items: RailItem[]
}

export function matterIdFromPath(path: string): string | null {
  const match = path.match(/^\/matters\/([^/]+)/)
  return match?.[1] ?? null
}

/**
 * The Verify rail, sourced from the organisation's real runs. A completed run
 * whose summary counts review-required or flagged findings is work waiting on a
 * person, so the rail must never say "Nothing to review" while such a run
 * exists: the rail and the pane beside it would contradict each other.
 */
export function verificationRailSections(
  verificationRuns: VerificationRun[],
): RailSection[] {
  const needsReview = verificationRuns.filter(
    (run) =>
      run.status === 'completed' &&
      (run.summary.reviewRequiredCount > 0 || run.summary.flaggedCount > 0),
  )
  return [
    {
      title: 'Runs',
      items:
        verificationRuns.length > 0
          ? verificationRuns.slice(0, 8).map((run) => ({
              id: `verify-run-${run.id}`,
              label: verificationRunRailLabel(run),
              note: verificationRunRailNote(run),
              to: '/verify',
              icon: ListChecks,
            }))
          : [
              {
                id: 'verify-empty',
                label: 'No verification runs',
                note: 'Start one from a document',
                to: '/matters',
                icon: ListChecks,
                muted: true,
              },
            ],
    },
    {
      title: 'Needs review',
      items:
        needsReview.length > 0
          ? needsReview.slice(0, 6).map((run) => ({
              id: `verify-review-${run.id}`,
              label: verificationOutcomeLabel(run.summary),
              note: verificationRunRailNote(run),
              to: '/verify',
              icon: WarningCircle,
            }))
          : [
              {
                id: 'verify-review-empty',
                label: 'Nothing to review',
                note: 'Completed runs with findings to check appear here',
                icon: WarningCircle,
                muted: true,
              },
            ],
    },
  ]
}

function verificationRunRailLabel(run: VerificationRun) {
  return run.status === 'completed'
    ? verificationOutcomeLabel(run.summary)
    : verificationRunStatusLabel(run.status)
}

function verificationRunRailNote(run: VerificationRun) {
  const at =
    run.status === 'completed'
      ? (run.completedAt ?? run.createdAt)
      : run.createdAt
  const label = run.status === 'completed' ? 'Completed' : 'Started'
  return `${label} ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(at))}`
}

export function useModeRailSections(
  mode: ModeId,
  currentPath: string,
  navigate: ReturnType<typeof useNavigate>,
): RailSection[] {
  const mattersQuery = useMattersList({
    enabled: mode === 'matters',
  })
  const runsQuery = useRedactionRunsList({
    enabled: mode === 'redact',
  })
  const verificationQuery = useOrganisationVerificationRuns(mode === 'verify')
  const matterId = matterIdFromPath(currentPath)
  const documentsQuery = useMatterDocuments(matterId ?? '', {
    enabled: mode === 'matters' && Boolean(matterId),
  })
  const recentSearches =
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage)

  const matters = mattersQuery.data ?? []
  const activeMatters = matters.filter((matter) => matter.status === 'active')
  const archivedMatters = matters.filter(
    (matter) => matter.status === 'archived',
  )
  const runs = runsQuery.data?.runs ?? []
  const pendingRuns = runs.filter((run) => isAttentionRun(run.status))
  const verificationRuns = verificationQuery.runs
  const documents = documentsQuery.data ?? []

  switch (mode) {
    case 'home':
      // Home has no mode rail — the desk already surfaces attention, matters,
      // and mode entry points; shortcuts would only duplicate the top bar.
      return []
    case 'search':
      return [
        {
          title: 'Search',
          items: [
            {
              id: 'search-new',
              label: 'New search',
              to: '/search',
              icon: MagnifyingGlass,
            },
          ],
        },
        {
          title: 'Recent queries',
          items:
            recentSearches.length > 0
              ? recentSearches.map((query) => ({
                  id: `recent-${query}`,
                  label: query,
                  icon: Clock,
                  onClick: () => {
                    window.sessionStorage.setItem(
                      'obiter.search.initialQuery',
                      query,
                    )
                    void navigate({ to: '/search' })
                  },
                }))
              : [
                  {
                    id: 'recent-empty',
                    label: 'No recent queries',
                    icon: Clock,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Opened',
          items: [
            {
              id: 'opened-empty',
              label: 'No judgments opened',
              note: 'Open a result from search',
              icon: FileText,
              muted: true,
            },
          ],
        },
        {
          title: 'Saved',
          items: [
            {
              id: 'saved-empty',
              label: 'No saved searches',
              note: 'Coming soon',
              icon: BookmarkSimple,
              muted: true,
            },
          ],
        },
      ]
    case 'matters':
      return [
        {
          title: 'Active',
          items:
            activeMatters.length > 0
              ? activeMatters.map((matter) => ({
                  id: `active-${matter.id}`,
                  label: matter.name,
                  note: matter.clientReference || undefined,
                  to: `/matters/${matter.id}`,
                  icon: Folders,
                }))
              : [
                  {
                    id: 'active-empty',
                    label: 'No active matters',
                    to: '/matters',
                    icon: Folders,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Archived',
          items:
            archivedMatters.length > 0
              ? archivedMatters.map((matter) => ({
                  id: `archived-${matter.id}`,
                  label: matter.name,
                  to: `/matters/${matter.id}`,
                  icon: Folders,
                  muted: true,
                }))
              : [
                  {
                    id: 'archived-empty',
                    label: 'None archived',
                    icon: Folders,
                    muted: true,
                  },
                ],
        },
        {
          title: 'In this matter',
          items: matterId
            ? documents.length > 0
              ? documents.slice(0, 8).map((document) => ({
                  id: `doc-${document.id}`,
                  label:
                    document.currentVersion?.filename ?? document.logicalKey,
                  note: document.currentVersion?.documentStatus,
                  to: `/matters/${matterId}/documents/${document.id}`,
                  icon: FileText,
                }))
              : [
                  {
                    id: 'docs-empty',
                    label: 'No documents yet',
                    note: 'Upload from the matter desk',
                    icon: FileText,
                    muted: true,
                  },
                ]
            : [
                {
                  id: 'docs-select',
                  label: 'Select a matter',
                  note: 'Documents appear here',
                  icon: FileText,
                  muted: true,
                },
              ],
        },
      ]
    case 'verify':
      return verificationRailSections(verificationRuns)
    case 'redact':
      return [
        {
          title: 'Runs',
          items:
            runs.length > 0
              ? runs.slice(0, 10).map((run) => ({
                  id: `run-${run.id}`,
                  label: run.sourceFilename,
                  note: run.matterName
                    ? `Matter · ${run.matterName}`
                    : run.status.replaceAll('_', ' '),
                  to: `/redact/${run.id}`,
                  icon: PencilSimple,
                }))
              : [
                  {
                    id: 'runs-empty',
                    label: 'No redaction runs',
                    note: 'Create one from Redact',
                    to: '/redact',
                    icon: PencilSimple,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Pending',
          items:
            pendingRuns.length > 0
              ? pendingRuns.slice(0, 6).map((run) => ({
                  id: `pending-${run.id}`,
                  label: run.sourceFilename,
                  note: run.status.replaceAll('_', ' '),
                  to: `/redact/${run.id}`,
                  icon: WarningCircle,
                }))
              : [
                  {
                    id: 'pending-empty',
                    label: 'Nothing pending',
                    icon: Clock,
                    muted: true,
                  },
                ],
        },
      ]
    default:
      return [
        {
          title: 'Navigate',
          items: [
            { id: 'nav-home', label: 'Home', to: '/', icon: House },
            {
              id: 'nav-search',
              label: 'Search',
              to: '/search',
              icon: MagnifyingGlass,
            },
          ],
        },
      ]
  }
}
