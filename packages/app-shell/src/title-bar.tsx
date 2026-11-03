import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  SidebarSimple,
} from '@obiter/ui/icons/shell'
import { Fragment, type ReactNode, type Ref } from 'react'
import type { AppPlatform } from '@obiter/contracts'
import { currentUserQueryOptions } from './current-user'
import { useMattersList } from './matters'
import { breadcrumbTrail, matterIdFromPath } from './navigation'
import { useSourceTitle } from './source-title'
import { readDesktopBridge } from './lib/desktop-bridge'
import { ShortcutHint, type ShellCommand } from './shell-shortcuts'

const iconButtonClass =
  'app-no-drag grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40'

function TitleButton({
  label,
  shortcut,
  onClick,
  expanded,
  controls,
  buttonRef,
  children,
}: {
  label: string
  shortcut?: ShellCommand
  onClick: () => void
  expanded?: boolean
  controls?: string
  buttonRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  const button = (
    <button
      type="button"
      ref={buttonRef}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      className={iconButtonClass}
    >
      {children}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          {label}
          {shortcut ? <ShortcutHint command={shortcut} /> : null}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

export function TitleBar({
  platform,
  navLabel,
  navExpanded,
  navControls,
  onToggleNav,
  navRef,
  rightSlotOpen,
  onToggleRightSlot,
}: {
  platform: AppPlatform
  navLabel: string
  navExpanded: boolean
  navControls: string
  onToggleNav: () => void
  navRef?: Ref<HTMLButtonElement>
  rightSlotOpen: boolean
  onToggleRightSlot: () => void
}) {
  const router = useRouter()
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const matters = useMattersList().data ?? []
  const currentMatterId = matterIdFromPath(pathname)
  const matterName =
    matters.find((matter) => matter.id === currentMatterId)?.name ?? null
  const sourceTitle = useSourceTitle(pathname)
  const trail = breadcrumbTrail(pathname, matterName, sourceTitle)
  const windowControls =
    platform === 'desktop' && readDesktopBridge()?.osPlatform === 'darwin'

  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 pr-2',
        windowControls ? 'pl-20' : 'pl-2',
        platform === 'desktop' && 'app-drag',
      )}
    >
      <div className="app-no-drag flex shrink-0 items-center gap-0.5">
        <TitleButton
          label={navLabel}
          shortcut="toggle-nav"
          expanded={navExpanded}
          controls={navControls}
          onClick={onToggleNav}
          buttonRef={navRef}
        >
          <SidebarSimple size={16} aria-hidden />
        </TitleButton>
        <TitleButton label="Back" onClick={() => router.history.back()}>
          <ArrowLeft size={16} aria-hidden />
        </TitleButton>
        <TitleButton label="Forward" onClick={() => router.history.forward()}>
          <ArrowRight size={16} aria-hidden />
        </TitleButton>
      </div>

      <nav
        aria-label="Breadcrumb"
        className="app-no-drag flex min-w-0 flex-1 items-center gap-2 px-2 text-meta whitespace-nowrap"
      >
        {me?.organisation ? (
          <>
            <Link
              to="/"
              className="max-w-[16rem] truncate text-muted hover:text-ink"
            >
              {me.organisation.name}
            </Link>
            <CrumbSeparator />
          </>
        ) : null}
        {trail.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            {index > 0 ? <CrumbSeparator /> : null}
            {crumb.to ? (
              <Link
                to={crumb.to}
                className="max-w-[18rem] shrink-0 truncate text-muted hover:text-ink"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="max-w-[24rem] truncate text-ink">
                {crumb.label}
              </span>
            )}
          </Fragment>
        ))}
      </nav>

      <TitleButton
        label={rightSlotOpen ? 'Hide panel' : 'Show panel'}
        shortcut="toggle-right-slot"
        expanded={rightSlotOpen}
        controls="app-shell-right-slot"
        onClick={onToggleRightSlot}
      >
        <SidebarSimple size={16} mirrored aria-hidden />
      </TitleButton>
    </header>
  )
}

function CrumbSeparator() {
  return (
    <CaretRight
      size={12}
      aria-hidden
      className="shrink-0 text-muted opacity-60"
    />
  )
}
