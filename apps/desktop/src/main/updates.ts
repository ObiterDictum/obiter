import type { UpdateCheckResult } from 'electron-updater'

export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface DesktopUpdater {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  allowDowngrade: boolean
  disableWebInstaller: boolean
  verifyUpdateCodeSignature: (
    publisherNames: string[],
    path: string,
  ) => Promise<string | null>
  checkForUpdates(): Promise<UpdateCheckResult | null>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  on(
    event: 'update-downloaded',
    listener: (info: { version: string }) => void,
  ): void
  on(event: 'error', listener: (error: Error) => void): void
}

interface UpdateTimers<TimerId> {
  setInterval(fn: () => void, ms: number): TimerId
  clearInterval(id: TimerId): void
}

export function startDesktopUpdates<TimerId>({
  updater,
  onReady,
  timers,
  log = console,
}: {
  updater: DesktopUpdater
  onReady: (version: string) => void
  timers: UpdateTimers<TimerId>
  log?: Pick<Console, 'warn'>
}) {
  let readyVersion: string | null = null

  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.allowPrerelease = false
  updater.allowDowngrade = false
  updater.disableWebInstaller = true
  updater.verifyUpdateCodeSignature = async () => null

  const check = () => {
    updater
      .checkForUpdates()
      .catch((error: unknown) =>
        log.warn('[obiter] update check failed:', error),
      )
  }
  const timer = timers.setInterval(check, UPDATE_CHECK_INTERVAL_MS)

  updater.on('update-downloaded', ({ version }) => {
    readyVersion = version
    timers.clearInterval(timer)
    onReady(version)
  })
  updater.on('error', (error) => log.warn('[obiter] updater error:', error))

  check()

  return {
    readyVersion: () => readyVersion,
    restart(): boolean {
      if (readyVersion === null) return false
      updater.quitAndInstall(true, true)
      return true
    },
  }
}
