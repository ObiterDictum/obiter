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
import { Robot } from '@obiter/ui/icons/shell'
import type { ReactNode } from 'react'
import { AccountMenu } from './account-menu'
import { MODULES, resolveSection } from './navigation'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { RailItem, SidebarCollapseToggle } from './sidebar-rows'
import { moduleShortcut } from './shell-shortcuts'
import { ThemeToggle } from './theme-toggle'

export function SidebarRail({
  isStaff = false,
  platform,
  rightSlotOpen,
  onToggleRightSlot,
  onExpand,
}: {
  isStaff?: boolean
  platform: AppPlatform
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
  onExpand: () => void
}) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(currentPath)
  const { counts, verifyTone } = useSidebarData()

  return (
    <nav
      id="app-shell-sidebar"
      aria-label="Workspace"
      className={cn(
        'flex w-12 shrink-0 flex-col items-center gap-1 pt-10 pb-1',
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
      <RailItem
        label="Agent"
        icon={Robot}
        onClick={onToggleRightSlot}
        expanded={rightSlotOpen}
        controls="app-shell-right-slot"
        shortcut="toggle-right-slot"
      />
      <RailSettingsLink current={section === 'settings'} />
      <RailSlot>
        <ThemeToggle />
      </RailSlot>
      {isStaff && (
        <Link
          to="/staff"
          aria-label="Staff"
          aria-current={currentPath.startsWith('/staff') ? 'page' : undefined}
          className="grid size-9 place-items-center rounded-lg text-muted hover:bg-hover hover:text-ink"
        >
          <ShieldCheck size={16} aria-hidden />
        </Link>
      )}
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
