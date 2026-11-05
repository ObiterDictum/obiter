export const BUILD_VERSION_PATH = '/.well-known/obiter-version'
export const BUILD_POLL_INTERVAL_MS = 5 * 60 * 1000

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface BuildWatchTarget {
  document: { visibilityState: DocumentVisibilityState }
  setInterval(fn: () => void, ms: number): number
  clearInterval(id: number): void
  addEventListener(type: 'focus', listener: () => void): void
  removeEventListener(type: 'focus', listener: () => void): void
}

export async function fetchServedBuild(
  fetchImpl: FetchImpl = (url, init) => fetch(url, init),
): Promise<string | null> {
  let body: unknown
  try {
    const res = await fetchImpl(BUILD_VERSION_PATH, { cache: 'no-store' })
    if (!res.ok) return null
    body = await res.json()
  } catch {
    return null
  }
  if (typeof body !== 'object' || body === null || !('build' in body))
    return null
  return typeof body.build === 'string' ? body.build : null
}

export function watchServedBuild({
  loadedBuild,
  onNewBuild,
  fetchBuild = () => fetchServedBuild(),
  target = window,
}: {
  loadedBuild: string
  onNewBuild: (build: string) => void
  fetchBuild?: () => Promise<string | null>
  target?: BuildWatchTarget
}): () => void {
  let stopped = false
  const check = async () => {
    if (stopped || target.document.visibilityState !== 'visible') return
    const served = await fetchBuild()
    if (stopped || served === null || served === loadedBuild) return
    stop()
    onNewBuild(served)
  }
  const onFocus = () => void check()
  const timer = target.setInterval(onFocus, BUILD_POLL_INTERVAL_MS)
  target.addEventListener('focus', onFocus)
  function stop() {
    stopped = true
    target.clearInterval(timer)
    target.removeEventListener('focus', onFocus)
  }
  return stop
}
