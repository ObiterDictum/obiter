import { flushUpdateSaves } from './update-saves'
import type { AppPlatform } from '@obiter/contracts'
import { ArrowClockwise } from '@obiter/ui/icons/shell'
import { Suspense, lazy, useEffect, useState } from 'react'
import { useUpdatePolicy } from './update-policy'
import { watchServedBuild } from './build-version'
import { readDesktopBridge } from './lib/desktop-bridge'

const RequiredUpdateDialog = lazy(() => import('./required-update-dialog'))

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
  organisationId = null,
}: {
  platform: AppPlatform
  loadedBuild?: string | null
  organisationId?: string | null
}) {
  const desktop = platform === 'desktop'
  const webBuildChanged = useNewWebBuild(desktop ? null : loadedBuild)
  const desktopReady = useDesktopUpdateReady(desktop)
  const ready = desktop ? desktopReady : webBuildChanged
  const policy = useUpdatePolicy(organisationId, ready)
  const requireUpdates = policy.data?.requireUpdates ?? false
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
  if (!ready) return null
  const label = desktop
    ? 'Update ready. Restart to update'
    : 'Update available. Reload to update'
  if (requireUpdates || saveFailed)
    return (
      <Suspense fallback={null}>
        <RequiredUpdateDialog
          required={requireUpdates}
          saving={saving}
          saveFailed={saveFailed}
          onUpdate={() => void saveAndUpdate()}
          onClose={() => setSaveFailed(false)}
        />
      </Suspense>
    )
  return (
    <button
      type="button"
      aria-label={label}
      disabled={saving}
      className="app-no-drag flex h-7 shrink-0 items-center gap-1.5 rounded-pill bg-brand px-2.5 text-caption font-medium text-brand-fg transition-colors duration-150 hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      onClick={() => void saveAndUpdate()}
    >
      <ArrowClockwise size={14} aria-hidden />
      <span className="max-sm:hidden">
        {saving
          ? 'Saving…'
          : desktop
            ? 'Restart to update'
            : 'Reload to update'}
      </span>
    </button>
  )
}
