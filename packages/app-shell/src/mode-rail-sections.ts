import type { useNavigate } from '@tanstack/react-router'
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
import { getRecentLegalSearches } from './views/LegalSearchView'

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
      return [
        {
          title: 'Runs',
          items: [
            {
              id: 'verify-overview',
              label: 'Overview',
              to: '/verify',
              icon: ListChecks,
            },
            {
              id: 'verify-empty',
              label: 'No verification runs',
              note: 'In development',
              icon: Clock,
              muted: true,
            },
          ],
        },
        {
          title: 'Needs review',
          items: [
            {
              id: 'verify-review-empty',
              label: 'Nothing to review',
              note: 'Claims will list here',
              icon: WarningCircle,
              muted: true,
            },
          ],
        },
        {
          title: 'Sources',
          items: [
            {
              id: 'verify-sources-empty',
              label: 'No linked sources',
              note: 'Evidence appears with a claim',
              icon: FileText,
              muted: true,
            },
          ],
        },
      ]
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
