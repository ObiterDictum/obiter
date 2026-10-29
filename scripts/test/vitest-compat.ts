import { setSystemTime, vi as bunVi } from 'bun:test'
import * as bunTest from 'bun:test'
import type { Mock } from 'bun:test'

declare module 'bun:test' {
  interface Matchers<T = unknown> {
    toHaveBeenCalledOnce(): T

    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toStrictEqual(expected: unknown): void
    toMatchObject(expected: unknown): void
    toContainEqual(expected: unknown): void
  }
}

process.env.NODE_ENV = 'test'
process.env.OBITER_TEST_RUNNER = '1'

export interface WaitOptions {
  timeout?: number
  interval?: number
}

export interface ViCompat {
  hoisted: <T>(fn: () => T) => T
  stubGlobal: (key: string, value: unknown) => void
  unstubAllGlobals: () => void
  waitFor: <T>(fn: () => T | Promise<T>, options?: WaitOptions) => Promise<T>
  mocked: <T extends (...args: any[]) => any>(item: T) => Mock<T>
  setSystemTime: (time: number | Date) => void
}

const stubbedGlobals = new Map<string, { existed: boolean; value: unknown }>()

type AnyFunction = (...args: never[]) => void
type AnyMock = Mock<AnyFunction>
const createdFunctions: Array<{
  mock: AnyMock
  impl: AnyFunction | undefined
}> = []
const baseFn = bunVi.fn.bind(bunVi) as unknown as (
  impl?: AnyFunction,
) => AnyMock
const baseRestoreAllMocks = bunVi.restoreAllMocks.bind(bunVi)

type EachRunner<T> = (
  name: string,
  fn: (value: T) => void,
  timeout?: number,
) => void

export function eachOf<T>(cases: readonly T[]): EachRunner<T> {
  return bunTest.it.each(cases as T[]) as EachRunner<T>
}

export const vi = Object.assign(bunVi, {
  hoisted: <T>(fn: () => T): T => fn(),

  stubGlobal(key: string, value: unknown): void {
    if (!stubbedGlobals.has(key)) {
      stubbedGlobals.set(key, {
        existed: key in globalThis,
        value: (globalThis as Record<string, unknown>)[key],
      })
    }
    ;(globalThis as Record<string, unknown>)[key] = value
  },

  unstubAllGlobals(): void {
    for (const [key, original] of stubbedGlobals) {
      if (original.existed) {
        ;(globalThis as Record<string, unknown>)[key] = original.value
      } else {
        delete (globalThis as Record<string, unknown>)[key]
      }
    }
    stubbedGlobals.clear()
  },

  fn: ((impl?: AnyFunction) => {
    const mock = baseFn(impl)
    createdFunctions.push({ mock, impl })
    return mock
  }) as unknown as typeof bunVi.fn,

  restoreAllMocks(): void {
    for (const { mock, impl } of createdFunctions) {
      const entry = mock as {
        mockImplementation?: (value: AnyFunction) => void
        mockReset?: () => void
        mockClear?: () => void
      }
      if (impl === undefined) entry.mockReset?.()
      else entry.mockImplementation?.(impl)
      entry.mockClear?.()
    }
    baseRestoreAllMocks()
  },

  async waitFor<T>(
    fn: () => T | Promise<T>,
    { timeout = 1_000, interval = 50 }: WaitOptions = {},
  ): Promise<T> {
    const deadline = Date.now() + timeout
    let lastError: unknown
    for (;;) {
      try {
        return await fn()
      } catch (error) {
        lastError = error
        if (Date.now() >= deadline) throw lastError
        await new Promise((resolve) => setTimeout(resolve, interval))
      }
    }
  },

  mocked: <T>(item: T): T => item,

  setSystemTime(time: number | Date): void {
    setSystemTime(time)
  },
}) as ViCompat & typeof bunVi
