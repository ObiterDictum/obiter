import { AppUpdateNotice } from './update-notice'
import { Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import { ArrowLeft, ArrowRight, CaretRight } from '@obiter/ui/icons/shell'
import { ArrowsInSimple } from '@obiter/ui/icons'
import { Fragment, Suspense, lazy, type ReactNode, type Ref } from 'react'
import type { AppPlatform } from '@obiter/contracts'
import { currentUserQueryOptions } from './current-user'
import { PaletteTrigger } from './palette-trigger'
const MatterSwitcherLazy = lazy(() =>
  import('./matter-switcher').then((module) => ({
    default: module.MatterSwitcher,
  })),
)
import { useMattersList } from './matters'
import { breadcrumbTrail, matterIdFromPath } from './navigation'
import { useSourceTitle } from './source-title'

const iconButtonClass =
  'app-no-drag grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40'

function TitleButton({
  label,
  onClick,
  buttonRef,
  children,
}: {
  label: string
  onClick: () => void
  buttonRef?: Ref<HTMLButtonElement>
  children: ReactNode
}) {
  const button = (
    <button
      type="button"
      ref={buttonRef}
      aria-label={label}
      onClick={onClick}
      className={iconButtonClass}
    >
      {children}
    </button>
  )
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

export function TitleBar({
  platform,
  loadedBuild = null,
  focusMode,
  onExitFocusMode,
  showSearch,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
  focusMode: boolean
  onExitFocusMode: () => void
  showSearch: boolean
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
      {showSearch ? <PaletteTrigger variant="title-bar" /> : null}
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
