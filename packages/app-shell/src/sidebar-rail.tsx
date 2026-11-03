import { Link, useRouterState } from '@tanstack/react-router'
import type { AppPlatform } from '@obiter/contracts'
import { ObiterMark, Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import { GearSix } from '@obiter/ui/icons'
import { AccountMenu } from './account-menu'
import { MODULES, resolveSection } from './navigation'
import { moduleTone, useSidebarData } from './sidebar-counts'
import { RailItem } from './sidebar-rows'
import { moduleShortcut } from './shell-shortcuts'
import { ThemeToggle } from './theme-toggle'

export function SidebarRail({ platform }: { platform: AppPlatform }) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(currentPath)
  const { counts, verifyTone } = useSidebarData()

  return (
    <nav
      id="app-shell-sidebar"
      aria-label="Workspace"
      className="flex w-[46px] shrink-0 flex-col items-center gap-1 py-1 max-md:h-12 max-md:w-full max-md:flex-row max-md:justify-between max-md:px-1 max-md:py-0"
    >
      <Link
        to="/"
        aria-label="Obiter home"
        className="mb-2 grid size-7 shrink-0 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:mb-0"
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
      <RailSettingsLink current={section === 'settings'} />
      <ThemeToggle />
      <AccountMenu platform={platform} />
    </nav>
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
      <GearSix size={18} aria-hidden />
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
