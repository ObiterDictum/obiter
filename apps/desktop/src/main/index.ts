import {
  app,
  ipcMain,
  nativeTheme,
  BrowserWindow,
  net,
  protocol,
  shell,
} from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

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
 * The absolute API origin the packaged renderer talks to, or null in
 * dev-desktop. Owned by the main process: in a packaged app an operator points
 * it at an API by setting OBITER_API_ORIGIN on the launched process (no
 * rebuild); absent that, the build-time default (electron.vite.config.ts
 * define) is used. In dev-desktop the renderer loads from the electron-vite
 * dev server and `/api` is proxied to the API, so the bridge exposes null and
 * apiUrl() keeps using relative paths — exactly the pre-bridge behaviour.
 *
 * Read once at boot and exposed to the renderer through the preload bridge as a
 * sync property (apiUrl() and the better-auth client baseURL are both sync).
 */
const packagedApiOrigin = app.isPackaged
  ? (process.env.OBITER_API_ORIGIN ?? __PACKAGED_API_ORIGIN_DEFAULT__)
  : null

ipcMain.on('obiter:get-api-origin', (event) => {
  event.returnValue = packagedApiOrigin
})

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
 * onto those files. Path traversal is rejected by normalizing and asserting the
 * result stays within the renderer root.
 */
function registerRendererProtocol() {
  const rendererRoot = join(__dirname, '../renderer')

  protocol.handle('obiter', (request) => {
    const requestUrl = new URL(request.url)
    // The "host" of an obiter:// URL is the desktop-auth segment; only the
    // pathname is the file path we serve.
    let requestPath = decodeURIComponent(requestUrl.pathname)

    // Treat the directory root as the document entry.
    if (requestPath === '/' || requestPath === '') {
      requestPath = '/index.html'
    }

    // Resolve against the renderer root, then confirm the normalized path did
    // not escape it (rejects encoded or literal '..' traversal).
    const resolved = join(rendererRoot, requestPath)
    const relative = resolved.slice(rendererRoot.length)
    if (relative !== '' && !relative.startsWith('/') && !relative.startsWith('\\')) {
      return new Response('Forbidden', { status: 403 })
    }

    return net.fetch(pathToFileURL(resolved).toString())
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
