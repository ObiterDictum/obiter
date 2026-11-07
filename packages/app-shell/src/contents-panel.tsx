import { Skeleton, cn } from '@obiter/ui'
import type { ReactNode } from 'react'
import { matterIdFromPath, type ShellSection } from './navigation'
import { PagePanelToggle } from './page-panel'
import { useMatter } from './matters'
import {
  MatterContents,
  MattersListContents,
  RedactContents,
  SearchContents,
  SettingsContents,
  VerifyContents,
} from './contents-sections'

const SECTION_TITLES = {
  home: 'Home',
  matters: 'Matters',
  search: 'Recent searches',
  verify: 'Verify runs',
  redact: 'Redaction runs',
  settings: 'Settings',
  other: 'Contents',
} satisfies Record<ShellSection, string>

function MatterTitle({ matterId }: { matterId: string }) {
  const matter = useMatter(matterId)
  if (matter.isPending) return <Skeleton className="h-3.5 w-32" />
  if (!matter.data) return <span>{SECTION_TITLES.matters}</span>
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{matter.data.name}</span>
      {matter.data.clientReference ? (
        <span className="shrink-0 font-mono text-caption text-subtle">
          {matter.data.clientReference}
        </span>
      ) : null}
    </>
  )
}

function ContentsTitle({
  section,
  matterId,
}: {
  section: ShellSection
  matterId: string | null
}) {
  if (section === 'matters' && matterId)
    return <MatterTitle matterId={matterId} />
  return <span className="truncate">{SECTION_TITLES[section]}</span>
}

function ContentsBody({
  section,
  pathname,
}: {
  section: ShellSection
  pathname: string
}) {
  const matterId = matterIdFromPath(pathname)
  switch (section) {
    case 'matters':
      return matterId ? (
        <MatterContents matterId={matterId} pathname={pathname} />
      ) : (
        <MattersListContents />
      )
    case 'verify':
      return <VerifyContents />
    case 'redact':
      return <RedactContents />
    case 'search':
      return <SearchContents />
    case 'settings':
      return <SettingsContents />
    default:
      return null
  }
}

function contentsLabel(section: ShellSection, pathname: string): string {
  const name = contentsPanelName(section, pathname)
  if (name) return name.charAt(0).toUpperCase() + name.slice(1)
  return SECTION_TITLES[section]
}

export function contentsPanelName(
  section: ShellSection,
  pathname: string,
): string | null {
  switch (section) {
    case 'home':
      return null
    case 'matters':
      return matterIdFromPath(pathname) ? 'matter contents' : 'matters list'
    case 'search':
      return 'recent searches'
    case 'verify':
      return 'verify runs'
    case 'redact':
      return 'redaction runs'
    case 'settings':
      return 'settings sections'
    default:
      return null
  }
}

export function ContentsPanel({
  section,
  pathname,
  overlay,
  onDismiss,
}: {
  section: ShellSection
  pathname: string
  overlay: boolean
  onDismiss?: () => void
}): ReactNode {
  const matterId = matterIdFromPath(pathname)
  const label = contentsLabel(section, pathname)
  return (
    <aside
      id="app-shell-contents"
      aria-label={label}
      className={cn(
        'flex min-h-0 shrink-0 flex-col border-line bg-surface',
        overlay
          ? 'absolute inset-y-0 left-0 z-30 w-[260px] border-r shadow-lg'
          : 'w-[250px] border-r',
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3 text-item text-ink">
        <ContentsTitle section={section} matterId={matterId} />
        <PagePanelToggle site="panel" />
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2"
        onClick={(event) => {
          if (!overlay || !onDismiss) return
          const target = event.target
          if (target instanceof Element && target.closest('a')) onDismiss()
        }}
      >
        <ContentsBody section={section} pathname={pathname} />
      </div>
    </aside>
  )
}
