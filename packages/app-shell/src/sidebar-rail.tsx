import { Link, useRouterState } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'
import {
  ObiterMark,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import type { ReactNode } from 'react'
import { AccountMenu } from './account-menu'
import { useIsMacPlatform } from './keyboard-platform'
import { MODULES, resolveSection } from './navigation'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { RailItem, SidebarCollapseToggle } from './sidebar-rows'
import { moduleShortcut } from './shell-shortcuts'
import { ThemeToggle } from './theme-toggle'

export function SidebarRail({
  isStaff = false,
  platform,
  onExpand,
}: {
  isStaff?: boolean
  platform: AppPlatform

  onExpand: () => void
}) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(currentPath)
  const { counts, verifyTone } = useSidebarData()
  const clearsTrafficLights = platform === 'desktop' && useIsMacPlatform()

  return (
    <nav
      id="app-shell-sidebar"
      aria-label="Workspace"
      className={cn(
        'flex w-12 shrink-0 flex-col items-center gap-1 pb-1.5',
        clearsTrafficLights && 'pt-10',
        'max-md:h-12 max-md:w-full max-md:flex-row max-md:justify-between max-md:px-1 max-md:py-0 max-md:pt-0',
      )}
    >
      <Link
        to="/"
        aria-label="Obiter home"
        className="grid h-10 w-9 shrink-0 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:h-7 max-md:w-7"
      >
        <ObiterMark className="size-6" title="" />
      </Link>
      {MODULES.map((module) => (
        <RailItem
          key={module.id}
          label={module.label}
          to={module.to}
          icon={module.icon}
          count={counts.get(module.id)}
          alertTone={moduleTone(module.id, verifyTone)}
          current={section === module.id}
          shortcut={moduleShortcut(module.id)}
        />
      ))}
      <span className="flex-1" />
      {isStaff ? <RailStaffLink current={section === 'staff'} /> : null}
      <RailSettingsLink current={section === 'settings'} />
      <RailSlot>
        <ThemeToggle />
      </RailSlot>
      <RailSlot className="max-md:hidden">
        <SidebarCollapseToggle
          expanded={false}
          onToggle={onExpand}
          side="right"
        />
      </RailSlot>
      <RailSlot>
        <AccountMenu platform={platform} />
      </RailSlot>
    </nav>
  )
}

function RailSlot({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('grid size-9 shrink-0 place-items-center', className)}>
      {children}
    </div>
  )
}

function RailStaffLink({ current }: { current: boolean }) {
  const link = (
    <Link
      to="/staff"
      aria-label="Staff"
      aria-current={current ? 'page' : undefined}
      className="relative grid size-9 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      <ShieldCheck size={16} aria-hidden />
    </Link>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" className="max-md:hidden">
        Staff
      </TooltipContent>
    </Tooltip>
  )
}

function RailSettingsLink({ current }: { current: boolean }) {
  const link = (
    <Link
      to="/settings"
      aria-label="Settings"
      aria-current={current ? 'page' : undefined}
      className="relative grid size-9 place-items-center rounded-lg text-muted transition-colors duration-150 hover:bg-hover hover:text-ink"
    >
      <GearSix size={16} aria-hidden />
    </Link>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right" className="max-md:hidden">
        Settings
      </TooltipContent>
    </Tooltip>
  )
}
