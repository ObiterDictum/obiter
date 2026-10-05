/**
 * The `vi` APIs bun:test does not implement, on top of bun:test's own `vi`.
 *
 * Test files import `vi` from here instead of `bun:test` when they use one of
 * the members below. Every member maps onto a bun:test primitive with the same
 * observable behaviour vitest had; nothing is stubbed to always-pass.
 *
 * Delete a member once no test imports it any more.
 */
import { setSystemTime, vi as bunVi } from 'bun:test'
import * as bunTest from 'bun:test'
import type { Mock } from 'bun:test'

declare module 'bun:test' {
  interface Matchers<T = unknown> {
    /** bun implements this matcher; bun-types does not declare it. */
    toHaveBeenCalledOnce(): T

    // vitest typed the matchers' argument, so a `let outcome` (uninitialised,
    // assigned inside an awaited callback) narrowed to undefined and still
    // compared. bun-types types them as the received value, which rejects
    // that shape. These keep the assertions the suite already wrote.
    toBe(expected: unknown): void
    toEqual(expected: unknown): void
    toStrictEqual(expected: unknown): void
    toMatchObject(expected: unknown): void
    toContainEqual(expected: unknown): void
  }
}

// bun test only sets NODE_ENV when the caller has not, and bun test leaves a
// preset value alone (probed: NODE_ENV=production survives). Tests must never
// read a developer's .env — packages/config/src/local-env.mjs skips loading
// under NODE_ENV=test — so pin it before any test file module runs. Loaded as
// --preload on every `bun test` invocation, which re-runs per file under
// --isolate, so each isolated file gets this before its own imports.
process.env.NODE_ENV = 'test'
// First-party test-runner marker: packages/config/src/local-env.mjs skips
// loading a developer's .env while this is set, even when a test flips
// NODE_ENV mid-file the way the env suites do. Replaces the old vitest-only
// VITEST variable now that the runner itself is gone.
process.env.OBITER_TEST_RUNNER = '1'

export interface WaitOptions {
  timeout?: number
  interval?: number
}

export interface ViCompat {
  /**
   * vitest ran this callback above the module's imports so factories could
   * close over it. bun:test registers mocks from the module body instead, so
   * calling it in place is equivalent: the value only has to exist before the
   * `vi.mock`/`mock.module` line below it runs.
   */
  hoisted: <T>(fn: () => T) => T
  /**
   * Set a global for the rest of the file. bun:test isolates each file, so no
   * cross-file restore bookkeeping is needed; `unstubAllGlobals` restores the
   * keys stubbed in this file, matching vitest within a single test file.
   */
  stubGlobal: (key: string, value: unknown) => void
  unstubAllGlobals: () => void
  /** Poll `fn` until it stops throwing, as vitest's waitFor did. */
  waitFor: <T>(fn: () => T | Promise<T>, options?: WaitOptions) => Promise<T>
  /**
   * At runtime this is a cast: the value is already a mock. The type mirrors
   * vitest's mocked(), which wraps a function in its mock type so `.mock*`
   * members typecheck even when the static type is the real signature.
   */
  mocked: <T extends (...args: any[]) => any>(item: T) => Mock<T>
  /** Delegates to bun:test's fake-timer clock. */
  setSystemTime: (time: number | Date) => void
}

const stubbedGlobals = new Map<string, { existed: boolean; value: unknown }>()

/**
 * vi.fn mocks created through this module, with the implementation they were
 * created with. vitest's restoreAllMocks() resets a vi.fn(impl) mock back to
 * that original impl; bun's restoreAllMocks() only restores spies, so a
 * `mockReturnValue` set in one test would leak into the next (this exact leak
 * broke the legal-search proxy suite). The shim below restores them itself.
 */
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

/**
 * `it.each` for a readonly table of objects.
 *
 * bun-types' each() overloads require a mutable array for a table of objects,
 * so the common `readonly` `as const` fixture matches no overload and the call
 * fails to typecheck (vitest's overloads accepted it). This narrows the same
 * behaviour to a signature bun-types can check, with one row per argument.
 */
type EachRunner<T> = (
  name: string,
  fn: (value: T) => void,
  timeout?: number,
) => void

export function eachOf<T>(cases: readonly T[]): EachRunner<T> {
  // Called as a method: bun's each() checks its receiver. The cast narrows
  // bun-types' mutable-array overload to the readonly table the fixtures use.
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
    // The registry is deliberately not cleared: module-scope mocks created
    // once (inside vi.hoisted) must be restored by every later call too, or a
    // mockReturnValue set in one test leaks into the ones after it.
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
