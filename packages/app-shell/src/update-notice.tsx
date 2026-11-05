import type { AppPlatform } from '@obiter/contracts'
import { Button } from '@obiter/ui'
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
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !(desktop ? desktopReady : webBuildChanged)) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-lg border border-line bg-raised py-2 pr-2 pl-4 shadow-md max-md:right-4 max-md:bottom-16"
    >
      <p className="min-w-0 flex-1 text-meta text-ink">
        {desktop
          ? 'A new version of Obiter is ready.'
          : 'A new version of Obiter is available.'}
      </p>
      <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
        Later
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() =>
          desktop
            ? void readDesktopBridge()?.restartToUpdate()
            : window.location.reload()
        }
      >
        {desktop ? 'Restart to update' : 'Reload'}
      </Button>
    </div>
  )
}
