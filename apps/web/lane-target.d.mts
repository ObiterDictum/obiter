/**
 * Declarations for lane-target.mjs, which stays `.mjs` so Node can load it
 * from playwright.config.ts without a transform. Keep the signatures aligned
 * with the implementation — TypeScript trusts this file over inference.
 */

export declare const SHARED_WEB_PORT: number
export declare const SHARED_API_PORT: number
export declare const WORKTREE_ROOT: string

export declare type LaneTargets = {
  envFile: string | null
  webPort: number
  apiPort: number
  webOrigin: string
  apiOrigin: string
}

/**
 * The subset of `fetch` the lane checks use: a single-argument call returning
 * a Response. Declared rather than `typeof fetch` so tests can inject a fake
 * without Bun's `preconnect` helper on the function object.
 */
export declare type LaneFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>

export declare function resolveLaneTargets(options?: {
  startDirectory?: string
  processEnv?: Record<string, string | undefined> | NodeJS.ProcessEnv
}): LaneTargets

export declare function readPort(
  raw: string | undefined | null,
  key: string,
  fallback: number,
): number

export declare function assertLaneTargets(
  targets: LaneTargets,
  options: { reuseExistingServer: boolean },
): void

export declare function verifyServedCheckout(
  targets: LaneTargets,
  options?: {
    worktreeRoot?: string
    fetchImpl?: LaneFetch
    headSha?: string | null
  },
): Promise<{ webRoot: string; apiRoot: string; envFile: string | null }>

export declare function headSha(startDirectory?: string): string | null

export declare function commonDirectory(paths: string[]): string | null
