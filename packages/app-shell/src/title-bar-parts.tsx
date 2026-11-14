import { AppUpdateNotice } from './update-notice'
import { Link, useRouterState } from '@tanstack/react-router'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import { CaretRight } from '@obiter/ui/icons/shell'
import { Fragment, Suspense, lazy, type ReactNode, type Ref } from 'react'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import { PaletteTrigger } from './palette-trigger'
import { matterIdFromPath, type Crumb } from './navigation'

const MatterSwitcherLazy = lazy(() =>
  import('./matter-switcher').then((module) => ({
    default: module.MatterSwitcher,
  })),
)

export const iconButtonClass =
  'app-no-drag grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40'

export const titleIconClass =
  'grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink aria-[current=page]:bg-fill aria-[current=page]:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export function TitleButton({
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

function CrumbSeparator() {
  return (
    <CaretRight
      size={12}
      aria-hidden
      className="shrink-0 text-muted opacity-60"
    />
  )
}

export function BreadcrumbNav({
  trail,
  orgName,
}: {
  trail: Crumb[]
  orgName?: string | null
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const currentMatterId = matterIdFromPath(pathname)
  return (
    <nav
      aria-label="Breadcrumb"
      className="app-no-drag flex min-w-0 flex-1 items-center gap-2 px-2 text-meta whitespace-nowrap"
    >
      {orgName ? (
        <>
          <Link
            to="/"
            className="max-w-[16rem] truncate text-muted hover:text-ink"
          >
            {orgName}
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
  )
}

export function TitleBarActions({
  platform,
  loadedBuild,
  me,
  showSearch,
}: {
  platform: AppPlatform
  loadedBuild: string | null
  me: MeResponse | undefined
  showSearch: boolean
}) {
  return (
    <>
      <AppUpdateNotice
        platform={platform}
        loadedBuild={loadedBuild}
        organisationId={me?.organisation?.id ?? null}
      />
      {showSearch ? <PaletteTrigger variant="title-bar" /> : null}
    </>
  )
}
