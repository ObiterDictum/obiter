import { describe, expect, it } from 'bun:test'

import { exitOnStartupFailure, installGracefulShutdown } from './lifecycle'

const log = { info() {}, error() {} }

function exitRecorder() {
  const exits: number[] = []
  let resolve: (code: number) => void = () => {}
  const exited = new Promise<number>((settle) => {
    resolve = settle
  })
  return {
    exits,
    exited,
    exit: (code: number) => {
      exits.push(code)
      resolve(code)
    },
  }
}

describe('installGracefulShutdown', () => {
  it('drains once and exits zero when a second signal arrives', async () => {
    const recorder = exitRecorder()
    let stops = 0
    installGracefulShutdown(
      {
        stopAccepting: async () => {
          stops += 1
        },
        closeResources: async () => {},
        pendingCount: () => 0,
      },
      { log, exit: recorder.exit },
    )

    process.emit('SIGTERM' as never, 'SIGTERM' as never)
    await recorder.exited
    process.emit('SIGINT' as never, 'SIGINT' as never)
    await Promise.resolve()

    expect(recorder.exits).toEqual([0])
    expect(stops).toBe(1)
  })

  it('forces a non-zero exit when the drain exceeds the deadline', async () => {
    const recorder = exitRecorder()
    installGracefulShutdown(
      {
        stopAccepting: () => new Promise<void>(() => {}),
        closeResources: async () => {},
      },
      { deadlineMs: 5, log, exit: recorder.exit },
    )

    process.emit('SIGINT' as never, 'SIGINT' as never)

    await expect(recorder.exited).resolves.toBe(1)
  })

  it('keeps draining when the pending connection count cannot be read', async () => {
    const recorder = exitRecorder()
    let closed = false
    installGracefulShutdown(
      {
        stopAccepting: async () => {},
        closeResources: async () => {
          closed = true
        },
        pendingCount: () => {
          throw new Error('synthetic count failure')
        },
      },
      { log, exit: recorder.exit },
    )

    process.emit('SIGTERM' as never, 'SIGTERM' as never)

    await expect(recorder.exited).resolves.toBe(0)
    expect(closed).toBe(true)
  })
})

describe('exitOnStartupFailure', () => {
  it('reports a boot failure and exits non-zero rather than serving', () => {
    const originalExit = process.exit
    const originalError = console.error
    const reported: unknown[][] = []
    let code: number | null = null
    process.exit = ((value: number) => {
      code = value
    }) as never
    console.error = (...args: unknown[]) => {
      reported.push(args)
    }
    const failure = new Error('synthetic boot failure')
    try {
      exitOnStartupFailure(failure)
    } finally {
      process.exit = originalExit
      console.error = originalError
    }

    expect(code).toBe(1)
    expect(reported[0]?.[1]).toBe(failure)
  })
})
