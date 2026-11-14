import { Link } from '@tanstack/react-router'
import { ObiterMark, cn } from '@obiter/ui'
import { GearSix, ShieldCheck } from '@obiter/ui/icons'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import { AccountMenu } from './account-menu'
import { ModuleTabs } from './module-tabs'
import { ShellMenuButton } from './shell-launcher'
import type { ShellSection } from './navigation'
import type { Crumb } from './navigation'
import { ThemeToggle } from './theme-toggle'
import {
  BreadcrumbNav,
  TitleBarActions,
  titleIconClass,
} from './title-bar-parts'

export function TabsTitleBar({
  platform,
  loadedBuild,
  me,
  section,
  rightSlotOpen,
  onToggleRightSlot,
  clearsTrafficLights,
}: {
  platform: AppPlatform
  loadedBuild: string | null
  me: MeResponse | undefined
  section: ShellSection
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
  clearsTrafficLights: boolean
}) {
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 pr-2',
        clearsTrafficLights ? 'pl-20' : 'pl-2',
        platform === 'desktop' && 'app-drag',
      )}
    >
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-1">
        <Link
          to="/"
          aria-label="Obiter home"
          className="grid size-8 shrink-0 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ObiterMark className="size-6" title="" />
        </Link>
        <ModuleTabs
          rightSlotOpen={rightSlotOpen}
          onToggleRightSlot={onToggleRightSlot}
        />
      </div>
      <div className="app-no-drag flex shrink-0 items-center gap-1">
        <TitleBarActions
          platform={platform}
          loadedBuild={loadedBuild}
          me={me}
          showSearch
        />
        <Link
          to="/settings"
          aria-label="Settings"
          aria-current={section === 'settings' ? 'page' : undefined}
          className={titleIconClass}
        >
          <GearSix size={16} aria-hidden />
        </Link>
        <ThemeToggle />
        {me?.isStaff ? (
          <Link
            to="/staff"
            aria-label="Staff"
            aria-current={section === 'staff' ? 'page' : undefined}
            className={titleIconClass}
          >
            <ShieldCheck size={16} aria-hidden />
          </Link>
        ) : null}
        <AccountMenu platform={platform} />
      </div>
    </header>
  )
}

export function CleanTitleBar({
  platform,
  loadedBuild,
  me,
  trail,
  orgName,
  rightSlotOpen,
  onToggleRightSlot,
  clearsTrafficLights,
}: {
  platform: AppPlatform
  loadedBuild: string | null
  me: MeResponse | undefined
  trail: Crumb[]
  orgName?: string | null
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
  clearsTrafficLights: boolean
}) {
  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 pr-2',
        clearsTrafficLights ? 'pl-20' : 'pl-2',
        platform === 'desktop' && 'app-drag',
      )}
    >
      <div className="app-no-drag flex min-w-0 flex-1 items-center gap-1">
        <ShellMenuButton
          rightSlotOpen={rightSlotOpen}
          onToggleRightSlot={onToggleRightSlot}
        />
        <BreadcrumbNav trail={trail} orgName={orgName} />
      </div>
      <TitleBarActions
        platform={platform}
        loadedBuild={loadedBuild}
        me={me}
        showSearch
      />
    </header>
  )
}
