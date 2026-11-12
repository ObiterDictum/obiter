import { Link, useRouterState } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'
import { ObiterMark, cn } from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import { AccountMenu } from './account-menu'
import { useIsMacPlatform } from './keyboard-platform'
import {
  AgentRow,
  MatterRow,
  ModuleRow,
  SidebarCollapseToggle,
} from './sidebar-rows'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { MODULES, matterIdFromPath, resolveSection } from './navigation'
import { ThemeToggle } from './theme-toggle'

export function Sidebar({
  isStaff = false,
  orgName,
  platform,
  rightSlotOpen,
  onToggleRightSlot,
  onCollapse,
}: {
  isStaff?: boolean
  orgName?: string | null
  platform: AppPlatform
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
  onCollapse: () => void
}) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(currentPath)
  const currentMatterId = matterIdFromPath(currentPath)
  const { counts, verifyTone, recent } = useSidebarData()
  const clearsTrafficLights = platform === 'desktop' && useIsMacPlatform()

  return (
    <aside
      id="app-shell-sidebar"
      aria-label="Workspace"
      className={cn(
        'flex w-[236px] shrink-0 flex-col gap-2 pr-2 pb-1 pl-1',
        clearsTrafficLights && 'pt-10',
      )}
    >
      <div className="flex h-10 items-center gap-2.5 px-1.5">
        <ObiterMark className="size-7 shrink-0" title="" />
        <div className="min-w-0">
          <p className="truncate text-item text-ink">Obiter</p>
          {orgName ? (
            <p className="truncate text-caption text-muted">{orgName}</p>
          ) : null}
        </div>
      </div>

      <nav
        aria-label="Workspace"
        className="flex min-h-0 flex-1 flex-col gap-px overflow-x-hidden overflow-y-auto"
      >
        <ul className="flex flex-col gap-px">
          {MODULES.map((module) => (
            <li key={module.id}>
              <ModuleRow
                label={module.label}
                to={module.to}
                icon={module.icon}
                count={counts.get(module.id)}
                alertTone={moduleTone(module.id, verifyTone)}
                current={section === module.id}
              />
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-col gap-px">
          <AgentRow expanded={rightSlotOpen} onClick={onToggleRightSlot} />
        </div>

        {recent.length > 0 ? (
          <div className="mt-4 flex flex-col gap-px">
            <p className="px-2 pt-2 pb-1 text-caption text-muted">
              Recent matters
            </p>
            <ul className="flex flex-col gap-px">
              {recent.map((matter) => (
                <li key={matter.id}>
                  <MatterRow
                    matter={matter}
                    current={matter.id === currentMatterId}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </nav>

      <div className="flex items-center gap-1 px-0.5 pt-1">
        <Link
          to="/settings"
          aria-label="Settings"
          aria-current={section === 'settings' ? 'page' : undefined}
          className="grid size-8 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <GearSix size={16} aria-hidden />
        </Link>
        <ThemeToggle />
        {isStaff && (
          <Link
            to="/staff"
            aria-label="Staff"
            aria-current={currentPath.startsWith('/staff') ? 'page' : undefined}
            className="grid size-8 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink"
          >
            <ShieldCheck size={16} aria-hidden />
          </Link>
        )}
        <SidebarCollapseToggle expanded onToggle={onCollapse} side="top" />
        <span className="ml-auto">
          <AccountMenu platform={platform} />
        </span>
      </div>
    </aside>
  )
}
