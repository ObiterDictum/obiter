import { AppUpdateNotice } from './update-notice'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  KeyboardHint,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@obiter/ui'
import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  MagnifyingGlass,
  SidebarSimple,
} from '@obiter/ui/icons/shell'
import { Fragment, Suspense, lazy, type ReactNode, type Ref } from 'react'
import type { AppPlatform } from '@obiter/contracts'
import { useCommandPalette } from './command-palette'
import { currentUserQueryOptions } from './current-user'
import { formatShortcut, useIsMacPlatform } from './keyboard-platform'
const MatterSwitcherLazy = lazy(() =>
  import('./matter-switcher').then((module) => ({
    default: module.MatterSwitcher,
  })),
)
import { useMattersList } from './matters'
import { breadcrumbTrail, matterIdFromPath } from './navigation'
import { useSourceTitle } from './source-title'
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
  loadedBuild = null,
  navLabel,
  navExpanded,
  navControls,
  onToggleNav,
  navRef,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
  navLabel: string
  navExpanded: boolean
  navControls: string
  onToggleNav: () => void
  navRef?: Ref<HTMLButtonElement>
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

  return (
    <header
      className={cn(
        'flex h-10 shrink-0 items-center gap-1 pr-2 max-md:pl-2',
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
            {currentMatterId && index === trail.length - 1 && !crumb.to ? (
              <Suspense
                fallback={
                  <span className="max-w-[24rem] truncate px-1 text-ink">
                    {crumb.label}
                  </span>
                }
              >
                <MatterSwitcherLazy
                  matterId={currentMatterId}
                  matterName={crumb.label}
                />
              </Suspense>
            ) : crumb.to ? (
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

      <AppUpdateNotice
        platform={platform}
        loadedBuild={loadedBuild}
        organisationId={me?.organisation?.id ?? null}
      />
      <PaletteTrigger />
    </header>
  )
}

function PaletteTrigger() {
  const openPalette = useCommandPalette()
  const isMac = useIsMacPlatform()
  return (
    <button
      type="button"
      aria-label="Search Obiter"
      onClick={(event) => openPalette(event.currentTarget)}
      className={cn(
        'app-no-drag ml-auto flex h-[30px] w-[min(300px,32vw)] shrink-0 items-center gap-2 rounded-md border border-line bg-surface pr-1 pl-3 text-left',
        'transition-colors duration-150 hover:border-line-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'max-compact:w-8 max-compact:justify-center max-compact:border-0 max-compact:bg-transparent max-compact:p-0',
      )}
    >
      <MagnifyingGlass size={16} className="shrink-0 text-subtle" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-meta text-subtle max-compact:hidden">
        Search Obiter
      </span>
      <KeyboardHint className="max-compact:hidden">
        {formatShortcut(['primary', 'K'], isMac)}
      </KeyboardHint>
    </button>
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
