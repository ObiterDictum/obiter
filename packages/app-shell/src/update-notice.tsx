import { flushUpdateSaves } from './update-saves'
import type { AppPlatform } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@obiter/ui'
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
  requireUpdates = false,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
  requireUpdates?: boolean
}) {
  const desktop = platform === 'desktop'
  const webBuildChanged = useNewWebBuild(desktop ? null : loadedBuild)
  const desktopReady = useDesktopUpdateReady(desktop)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  function applyUpdate() {
    if (desktop) void readDesktopBridge()?.restartToUpdate()
    else window.location.reload()
  }
  async function saveAndUpdate() {
    setSaving(true)
    try {
      if (await flushUpdateSaves()) applyUpdate()
      else setSaveFailed(true)
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }
  if (!(desktop ? desktopReady : webBuildChanged)) return null
  const label = desktop
    ? 'Update ready. Restart to update'
    : 'Update available. Reload to update'
  if (requireUpdates)
    return (
      <Dialog open onOpenChange={(_open, details) => details.cancel()}>
        <DialogContent size="sm">
          <DialogTitle>Update required</DialogTitle>
          <DialogDescription>
            Your organisation requires the latest version of Obiter.
          </DialogDescription>
          {saveFailed ? (
            <p role="alert">
              The update waits until your work is saved. Your changes could not
              be saved. Try again.
            </p>
          ) : null}
          <Button disabled={saving} onClick={() => void saveAndUpdate()}>
            {saving ? 'Saving your work…' : 'Update now'}
          </Button>
        </DialogContent>
      </Dialog>
    )
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
            <span className="absolute top-0 right-0 size-1.5 rounded-full bg-brand" />
          </button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
