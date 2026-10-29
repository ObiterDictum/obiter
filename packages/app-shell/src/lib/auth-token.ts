import { readDesktopBridge } from './desktop-bridge'

let token: string | null = null
let loadPromise: Promise<void> | null = null
let revision = 0

export function loadDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge || loadPromise) {
    return loadPromise ?? Promise.resolve()
  }

  const loadRevision = revision
  loadPromise = bridge
    .getAuthToken()
    .then((storedToken) => {
      if (revision === loadRevision) {
        token = storedToken
      }
    })
    .catch(() => {
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

export async function setDesktopAuthToken(value: string): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  await bridge.setAuthToken(value)
  revision += 1
  token = value
  loadPromise = Promise.resolve()
}

export async function clearDesktopAuthToken(): Promise<void> {
  const bridge = readDesktopBridge()
  if (!bridge) {
    return
  }

  try {
    await bridge.clearAuthToken()
  } catch (error) {
    loadPromise = null
    throw error
  }

  revision += 1
  token = null
  loadPromise = Promise.resolve()
}
