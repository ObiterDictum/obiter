import { readDesktopBridge } from './desktop-bridge'

let token: string | null = null
let loadPromise: Promise<void> | null = null
let revision = 0

/**
 * Loads the main-process-held desktop token once. Web and SSR have no bridge,
 * so they never enter this persistence path.
 */
export async function loadDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge || loadPromise) {
    return loadPromise ?? Promise.resolve()
  }

  const loadRevision = revision
  loadPromise = bridge.getAuthToken().then((storedToken) => {
    if (revision === loadRevision) {
      token = storedToken
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

export async function setDesktopAuthToken(value: string): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  revision += 1
  token = value
  loadPromise ??= Promise.resolve()
  await bridge.setAuthToken(value)
}

export async function clearDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  revision += 1
  token = null
  loadPromise ??= Promise.resolve()
  await bridge.clearAuthToken()
}
