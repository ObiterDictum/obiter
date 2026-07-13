import {
  app,
  ipcMain,
  nativeTheme,
  BrowserWindow,
  net,
  protocol,
  safeStorage,
  shell,
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { resolveRendererPath } from './renderer-path'
import { DesktopAuthTokenStore } from './auth-token-store'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Custom scheme the packaged renderer is served from. With `standard` + `secure`
 * privileges the renderer's Origin is a stable exact-match value the API trusts
 * (OBITER_DESKTOP_ORIGIN, default obiter://desktop-auth) — no wildcard, no
 * trust loosening. Registered before app.whenReady so the privileges apply
 * before any window loads.
 *
 * registerSchemesAsPrivileged MUST run as a top-level statement (synchronously
 * at module load, pre-ready); moving it inside whenReady leaves the scheme
 * unprivileged and the Origin wrong.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'obiter',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

/**
 * Resolve the packaged API origin at boot. The value must be a valid absolute
 * http/https URL: the renderer builds every API/auth URL with
 * `new URL(path, origin)`, which throws on a malformed origin. Validate here
 * so a bad operator config falls back to the build default with a clear log
 * rather than breaking every renderer request with a TypeError.
 *
 * Empty/whitespace-only OBITER_API_ORIGIN is treated as absent (an unset env
 * var must not silently win over the default and degrade the app to relative
 * paths that have nowhere to go in a packaged build).
 */
function resolvePackagedApiOrigin(): string {
  const raw = (process.env.OBITER_API_ORIGIN ?? '').trim()

  if (raw.length > 0) {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return raw
      }
      console.error(
        `[obiter] OBITER_API_ORIGIN "${raw}" is not an http/https URL; falling back to the build default.`,
      )
    } catch {
      console.error(
        `[obiter] OBITER_API_ORIGIN "${raw}" is not a valid URL; falling back to the build default.`,
      )
    }
  }

  return __PACKAGED_API_ORIGIN_DEFAULT__
}

/**
 * The absolute API origin the packaged renderer talks to, or null in
 * dev-desktop. In a packaged app an operator points it at an API by setting
 * OBITER_API_ORIGIN on the launched process (no rebuild); absent or invalid,
 * the validated build-time default (electron.vite.config.ts define) is used.
 * In dev-desktop the renderer loads from the electron-vite dev server and
 * `/api` is proxied to the API, so the bridge exposes null and apiUrl() keeps
 * using relative paths — exactly the pre-bridge behaviour.
 *
 * Read once at boot and exposed to the renderer through the preload bridge as a
 * sync property (apiUrl() and the better-auth client baseURL are both sync).
 */
const packagedApiOrigin = app.isPackaged ? resolvePackagedApiOrigin() : null

ipcMain.on('obiter:get-api-origin', (event) => {
  event.returnValue = packagedApiOrigin
})

const authTokenStore = new DesktopAuthTokenStore(
  join(app.getPath('userData'), 'desktop-auth-token'),
  safeStorage,
)

ipcMain.handle('obiter:get-auth-token', () => authTokenStore.get())
ipcMain.handle('obiter:set-auth-token', (_event, token: unknown) => {
  if (typeof token !== 'string') {
    throw new Error('Desktop auth token must be a string.')
  }
  return authTokenStore.set(token)
})
ipcMain.handle('obiter:clear-auth-token', () => authTokenStore.clear())

/**
 * Page background for the Electron window, picked before the renderer loads
 * so the launch does not flash the wrong theme. These mirror the --obiter-bg
 * token values in packages/ui/src/tokens.css; the main process cannot read a
 * CSS variable, so the constants are kept in sync by hand. A theme change
 * mid-session still requires a relaunch to update this launch color — the
 * renderer's <html> background flips immediately in CSS.
 */
const windowBackground = nativeTheme.shouldUseDarkColors ? '#1a1612' : '#f4efe4'

/**
 * Serve the packaged renderer bundle over the obiter:// scheme. The built
 * index.html and its hashed assets live in ../renderer (relative to the main
 * entry) after electron-vite build; this handler maps obiter://desktop-auth/<p>
 * onto those files.
 *
 * Containment (traversal rejection) is delegated to resolveRendererPath, the
 * pure, Electron-free boundary. The handler wraps every step that can throw or
 * reject so no request surfaces as an unhandled rejection:
 *   - malformed % sequences in the URL decode → 400
 *   - traversal or an out-of-root resolve → 403
 *   - a missing file from net.fetch → 404
 */
function registerRendererProtocol() {
  const rendererRoot = join(__dirname, '../renderer')

  protocol.handle('obiter', async (request) => {
    let requestPath: string
    try {
      requestPath = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      // Malformed percent-encoding (e.g. /%zz) throws URIError on decode.
      return new Response('Bad Request', { status: 400 })
    }

    const resolved = resolveRendererPath(rendererRoot, requestPath)
    if (resolved === null) {
      // Escaped the renderer root — literal or encoded '..' traversal, or an
      // absolute path on a different root.
      return new Response('Forbidden', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(resolved).toString())
    } catch {
      // net.fetch rejects when the file does not exist (ENOENT) or is
      // unreadable; surface a 404 rather than an unhandled rejection.
      return new Response('Not Found', { status: 404 })
    }
  })
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1180,
    minHeight: 780,
    backgroundColor: windowBackground,
    autoHideMenuBar: true,
    title: 'Obiter',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // package.json is "type": "module", so electron-vite emits the preload
      // as ESM (.mjs). The packaged main loads this file from disk; the .mjs
      // extension must match the build output (out/preload/index.mjs). In dev,
      // electron-vite resolves the preload independently of this path.
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation of the main window to any origin other than the
  // renderer's own. The window-open handler already routes new windows to the
  // browser, but an <a>/<meta>/<script> navigation of the main frame would
  // load remote content into the privileged obiter:// renderer (preload bridge
  // attached, same Origin the API trusts) — a full privilege escape. Only
  // same-origin navigations (obiter://desktop-auth in a packaged build, the
  // electron-vite dev URL in dev) are allowed.
  const allowedOrigin =
    process.env.ELECTRON_RENDERER_URL ?? 'obiter://desktop-auth'
  let allowedNavigationOrigin: string | null = null
  try {
    allowedNavigationOrigin = new URL(allowedOrigin).origin
  } catch {
    console.error(
      '[obiter] Invalid Electron renderer URL; blocking navigation.',
    )
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    let targetOrigin: string | null = null
    try {
      targetOrigin = new URL(url).origin
    } catch {
      targetOrigin = null
    }
    if (targetOrigin !== allowedNavigationOrigin) {
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    // Dev: load the electron-vite renderer dev server (http://localhost:5173).
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    // Packaged: serve the built bundle over the registered custom scheme so the
    // renderer Origin is the stable obiter://desktop-auth the API trusts.
    void mainWindow.loadURL('obiter://desktop-auth/index.html')
  }
}

app.whenReady().then(() => {
  registerRendererProtocol()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
