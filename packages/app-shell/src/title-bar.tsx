import { useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowsInSimple } from '@obiter/ui/icons'
import { ArrowLeft, ArrowRight } from '@obiter/ui/icons/shell'
import { cn } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { currentUserQueryOptions } from './current-user'
import { useIsMacPlatform } from './keyboard-platform'
import type { ShellLayout } from './shell-layout'
import { SETTINGS_SECTIONS, useSettingsSection } from './settings-sections'
import { useMattersList } from './matters'
import { breadcrumbTrail, matterIdFromPath, resolveSection } from './navigation'
import { useSourceTitle } from './source-title'
import { CleanTitleBar, TabsTitleBar } from './title-bar-layouts'
import { BreadcrumbNav, TitleBarActions, TitleButton } from './title-bar-parts'

export function TitleBar({
  platform,
  loadedBuild = null,
  focusMode,
  onExitFocusMode,
  showSearch,
  chrome,
  rightSlotOpen,
  onToggleRightSlot,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
  focusMode: boolean
  onExitFocusMode: () => void
  showSearch: boolean
  chrome: ShellLayout
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
}) {
  const router = useRouter()
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const section = resolveSection(pathname)
  const settingsSectionId = useSettingsSection(me)
  const settingsSection = SETTINGS_SECTIONS.find(
    (item) => item.id === settingsSectionId,
  )?.label
  const matters = useMattersList().data ?? []
  const currentMatterId = matterIdFromPath(pathname)
  const matterName =
    matters.find((matter) => matter.id === currentMatterId)?.name ?? null
  const sourceTitle = useSourceTitle(pathname)
  const trail = breadcrumbTrail(pathname, matterName, sourceTitle, {
    settingsSection,
    staff: me?.isStaff === true,
  })
  const variant = focusMode ? 'sidebar' : chrome
  const clearsTrafficLights =
    platform === 'desktop' &&
    useIsMacPlatform() &&
    (focusMode || chrome !== 'sidebar')

  if (variant === 'tabs') {
    return (
      <TabsTitleBar
        platform={platform}
        loadedBuild={loadedBuild}
        me={me}
        section={section}
        rightSlotOpen={rightSlotOpen}
        onToggleRightSlot={onToggleRightSlot}
        clearsTrafficLights={clearsTrafficLights}
      />
    )
  }

  if (variant === 'clean') {
    return (
      <CleanTitleBar
        platform={platform}
        loadedBuild={loadedBuild}
        me={me}
        trail={trail}
        orgName={me?.organisation?.name}
        rightSlotOpen={rightSlotOpen}
        onToggleRightSlot={onToggleRightSlot}
        clearsTrafficLights={clearsTrafficLights}
      />
    )
  }

  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 pr-2',
        clearsTrafficLights ? 'pl-20' : 'max-md:pl-2',
        platform === 'desktop' && 'app-drag',
      )}
    >
      <div className="app-no-drag flex shrink-0 items-center gap-0.5">
        {focusMode ? (
          <TitleButton label="Leave focus mode" onClick={onExitFocusMode}>
            <ArrowsInSimple size={16} aria-hidden />
          </TitleButton>
        ) : null}
        <TitleButton label="Back" onClick={() => router.history.back()}>
          <ArrowLeft size={16} aria-hidden />
        </TitleButton>
        <TitleButton label="Forward" onClick={() => router.history.forward()}>
          <ArrowRight size={16} aria-hidden />
        </TitleButton>
      </div>

      <BreadcrumbNav trail={trail} orgName={me?.organisation?.name} />

      <TitleBarActions
        platform={platform}
        loadedBuild={loadedBuild}
        me={me}
        showSearch={showSearch}
      />
    </header>
  )
}
