import type { AppPlatform } from '@obiter/contracts'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import { ArrowClockwise } from '@obiter/ui/icons/shell'
import { useEffect, useState } from 'react'
import { watchServedBuild } from './build-version'
import { readDesktopBridge } from './lib/desktop-bridge'

function useNewWebBuild(loadedBuild: string | null): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!loadedBuild) return
    return watchServedBuild({
      loadedBuild,
      onNewBuild: () => setAvailable(true),
    })
  }, [loadedBuild])
  return available
}

function useDesktopUpdateReady(enabled: boolean): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!enabled) return
    return readDesktopBridge()?.onUpdateReady(() => setReady(true))
  }, [enabled])
  return ready
}

export function AppUpdateNotice({
  platform,
  loadedBuild = null,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
}) {
  const desktop = platform === 'desktop'
  const webBuildChanged = useNewWebBuild(desktop ? null : loadedBuild)
  const desktopReady = useDesktopUpdateReady(desktop)
  if (!(desktop ? desktopReady : webBuildChanged)) return null
  const label = desktop
    ? 'Update ready. Restart to update'
    : 'Update available. Reload to update'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            className="app-no-drag relative grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() =>
              desktop
                ? void readDesktopBridge()?.restartToUpdate()
                : window.location.reload()
            }
          >
            <ArrowClockwise size={16} aria-hidden />
            <span className="absolute top-0 right-0 size-1.5 rounded-full bg-accent" />
          </button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
