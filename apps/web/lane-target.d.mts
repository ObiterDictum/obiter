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
