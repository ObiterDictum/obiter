import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import { Suspense, lazy, type ReactNode } from 'react'
import { currentUserQueryOptions } from './current-user'
import { useMattersList } from './matters'
import {
  MODULES,
  matterIdFromPath,
  resolveSection,
  type ModuleItem,
} from './navigation'
import { countNote, countToneClass } from './sidebar-rows'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { SETTINGS_SECTIONS, useSettingsSection } from './settings-sections'
import { useSourceTitle } from './source-title'

const MatterSwitcherLazy = lazy(() =>
  import('./matter-switcher').then((module) => ({
    default: module.MatterSwitcher,
  })),
)

function ModuleTab({
  label,
  to,
  icon: Icon,
  count,
  alertTone,
  current,
}: {
  label: string
  to: string
  icon: ModuleItem['icon']
  count?: number
  alertTone?: 'danger' | 'warning' | 'success'
  current: boolean
}) {
  const note = countNote(label, count)
  const toneClass = countToneClass(label, alertTone)
  return (
    <Link
      to={to}
      aria-label={note ? `${label}, ${note}` : label}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-meta',
        'transition-colors duration-150',
        current
          ? 'bg-fill font-medium text-ink'
          : 'text-muted hover:bg-hover hover:text-ink',
      )}
    >
      <Icon size={16} weight={current ? 'fill' : 'regular'} aria-hidden />
      <span>{label}</span>
      {alertTone === 'danger' && count ? (
        <span aria-hidden className="size-1.5 rounded-pill bg-danger" />
      ) : null}
      {count ? (
        <span
          aria-hidden
          className={cn('text-caption tabular-nums', toneClass)}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}

function TabDetail({ children }: { children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center text-meta text-muted">
      {children}
    </span>
  )
}

export function ModuleTabs() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(pathname)
  const matterId = matterIdFromPath(pathname)
  const matters = useMattersList().data ?? []
  const matterName =
    matters.find((matter) => matter.id === matterId)?.name ?? 'Matter'
  const sourceTitle = useSourceTitle(pathname)
  const { data: me } = useQuery(currentUserQueryOptions())
  const settingsSection = useSettingsSection(me)
  const settingsLabel = SETTINGS_SECTIONS.find(
    (item) => item.id === settingsSection,
  )?.label
  const { counts, verifyTone } = useSidebarData()

  return (
    <nav
      aria-label="Modules"
      className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
    >
      {MODULES.map((module) => (
        <span key={module.id} className="flex shrink-0 items-center gap-1">
          <ModuleTab
            label={module.label}
            to={module.to}
            icon={module.icon}
            count={counts.get(module.id)}
            alertTone={moduleTone(module.id, verifyTone)}
            current={section === module.id}
          />
          {module.id === 'matters' && matterId ? (
            <Suspense fallback={null}>
              <MatterSwitcherLazy matterId={matterId} matterName={matterName} />
            </Suspense>
          ) : null}
          {module.id === 'search' &&
          section === 'search' &&
          pathname !== '/search' &&
          sourceTitle ? (
            <TabDetail>
              <span className="max-w-[18rem] truncate">{sourceTitle}</span>
            </TabDetail>
          ) : null}
        </span>
      ))}
      {section === 'settings' ? (
        <span className="flex shrink-0 items-center gap-1">
          <ModuleTab label="Settings" to="/settings" icon={GearSix} current />
          {settingsLabel ? <TabDetail>{settingsLabel}</TabDetail> : null}
        </span>
      ) : null}
      {section === 'staff' && me?.isStaff ? (
        <span className="flex shrink-0 items-center gap-1">
          <ModuleTab label="Staff" to="/staff" icon={ShieldCheck} current />
          <TabDetail>Access review</TabDetail>
        </span>
      ) : null}
    </nav>
  )
}
