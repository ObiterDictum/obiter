import { describe, expect, it, mock } from 'bun:test'
import type { UpdateCheckResult } from 'electron-updater'
import {
  UPDATE_CHECK_INTERVAL_MS,
  startDesktopUpdates,
  type DesktopUpdater,
} from './updates'

type Listener = (payload: never) => void

function fakeUpdater(
  check: () => Promise<UpdateCheckResult | null> = async () => null,
) {
  const listeners = new Map<string, Listener[]>()
  const updater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: true,
    allowDowngrade: true,
    disableWebInstaller: false,
    verifyUpdateCodeSignature: async (
      _publisherNames: string[],
      _path: string,
    ): Promise<string | null> => 'not signed',
    checkForUpdates: mock(check),
    quitAndInstall: mock(() => {}),
    on: (event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
  } satisfies DesktopUpdater
  const emit = (event: string, payload: unknown) => {
    for (const listener of listeners.get(event) ?? [])
      (listener as (value: unknown) => void)(payload)
  }
  return { updater, emit }
}

function fakeTimers() {
  const intervals: { fn: () => void; ms: number }[] = []
  return {
    intervals,
    setInterval: (fn: () => void, ms: number) => {
      intervals.push({ fn, ms })
      return intervals.length
    },
    clearInterval: mock((_id: number) => {}),
    tick: () => intervals.forEach(({ fn }) => fn()),
  }
}

const quietLog = { warn: () => {} }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('desktop updates', () => {
  it('downloads in the background but never installs without the person asking', () => {
    const { updater } = fakeUpdater()
    startDesktopUpdates({
      updater,
      onReady: () => {},
      timers: fakeTimers(),
      log: quietLog,
    })
    expect(updater.autoDownload).toBe(true)
    expect(updater.allowPrerelease).toBe(false)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.disableWebInstaller).toBe(true)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('accepts the unsigned installer without Authenticode verification', async () => {
    const { updater } = fakeUpdater()
    startDesktopUpdates({
      updater,
      onReady: () => {},
      timers: fakeTimers(),
      log: quietLog,
    })
    expect(
      await updater.verifyUpdateCodeSignature(['Obiter'], 'C:\\update.exe'),
    ).toBeNull()
  })

  it('checks for an update at start and every four hours', () => {
    const { updater } = fakeUpdater()
    const timers = fakeTimers()
    startDesktopUpdates({ updater, onReady: () => {}, timers, log: quietLog })
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(timers.intervals.map(({ ms }) => ms)).toEqual([
      UPDATE_CHECK_INTERVAL_MS,
    ])
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000)
    timers.tick()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('tells the window once the update has downloaded and stops checking', () => {
    const { updater, emit } = fakeUpdater()
    const timers = fakeTimers()
    const ready: string[] = []
    const updates = startDesktopUpdates({
      updater,
      onReady: (version) => ready.push(version),
      timers,
      log: quietLog,
    })
    expect(updates.readyVersion()).toBeNull()
    emit('update-downloaded', { version: '0.2.0' })
    expect(ready).toEqual(['0.2.0'])
    expect(updates.readyVersion()).toBe('0.2.0')
    expect(timers.clearInterval).toHaveBeenCalledTimes(1)
  })

  it('restarts into the update only when asked, and only once it has downloaded', () => {
    const { updater, emit } = fakeUpdater()
    const updates = startDesktopUpdates({
      updater,
      onReady: () => {},
      timers: fakeTimers(),
      log: quietLog,
    })
    expect(updates.restart()).toBe(false)
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    emit('update-downloaded', { version: '0.2.0' })
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    expect(updates.restart()).toBe(true)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('logs a failed check and keeps the app running without telling the window', async () => {
    const { updater, emit } = fakeUpdater(() =>
      Promise.reject(new Error('offline')),
    )
    const warnings: unknown[][] = []
    const ready: string[] = []
    startDesktopUpdates({
      updater,
      onReady: (version) => ready.push(version),
      timers: fakeTimers(),
      log: { warn: (...args: unknown[]) => warnings.push(args) },
    })
    await settle()
    emit('error', new Error('feed unreachable'))
    expect(ready).toEqual([])
    expect(warnings.map(([message]) => message)).toEqual([
      '[obiter] update check failed:',
      '[obiter] updater error:',
    ])
  })
})
