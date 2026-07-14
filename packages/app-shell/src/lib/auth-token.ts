import { readDesktopBridge } from './desktop-bridge'

let token: string | null = null
let loadPromise: Promise<void> | null = null
let revision = 0

/**
 * Loads the main-process-held desktop token once. Web and SSR have no bridge,
 * so they never enter this persistence path.
 *
 * A transient IPC failure degrades to "no token this attempt" (token stays
 * null, the rejection is swallowed) and resets loadPromise so the next read
 * retries — it must not permanently break the bearer path for the process
 * lifetime, and must never surface as a rejection from getDesktopAuthToken().
 */
export function loadDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge || loadPromise) {
    return loadPromise ?? Promise.resolve()
  }

  const loadRevision = revision
  loadPromise = bridge
    .getAuthToken()
    .then((storedToken) => {
      // A newer set/clear bumped revision while this load was in flight; the
      // in-memory value they established is authoritative, so drop this result.
      if (revision === loadRevision) {
        token = storedToken
      }
    })
    .catch(() => {
      // Reset so the next getDesktopAuthToken() retries rather than caching
      // the failure forever. Degrade to "no token this attempt": leave token
      // as-is (null on first load) and resolve cleanly.
      if (revision === loadRevision) {
        loadPromise = null
      }
    })
  return loadPromise
}

export async function getDesktopAuthToken(): Promise<string | null> {
  if (!readDesktopBridge()) {
    return null
  }

  await loadDesktopAuthToken()
  return token
}

/**
 * Persist a token. Durable first: the IPC write must succeed before memory
 * claims the new value, so a failed persist leaves memory honest about what is
 * (not) on disk. The rejection propagates to the caller (the auth client's
 * onSuccess) so a failed persist is visible.
 */
export async function setDesktopAuthToken(value: string): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  await bridge.setAuthToken(value)
  // Only on success: bump revision (invalidating any in-flight stale load),
  // set memory, and pin loadPromise so the next read uses memory, not IPC.
  revision += 1
  token = value
  loadPromise = Promise.resolve()
}

/**
 * Clear the token. Durable first: the IPC clear must succeed before memory is
 * nulled, so a failed clear does not leave the renderer looking signed out
 * while the disk keeps the session. On failure, reset loadPromise so the next
 * read reconciles from main rather than trusting possibly-stale memory, and
 * let the rejection propagate. Sign-out handling in auth.ts runs inside a
 * try/finally, so the query-cache clear still happens regardless.
 */
export async function clearDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  try {
    await bridge.clearAuthToken()
  } catch (error) {
    // The durable clear failed; do not lie about sign-out. Reset loadPromise so
    // the next read reconciles from main (which may still hold the token) and
    // surface the failure to the caller.
    loadPromise = null
    throw error
  }

  revision += 1
  token = null
  loadPromise = Promise.resolve()
}
