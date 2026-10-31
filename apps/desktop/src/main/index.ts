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
import {
  isAllowedNavigation,
  isSafeExternalUrl,
  parseAllowedOrigin,
} from './navigation-guard'

const __dirname = dirname(fileURLToPath(import.meta.url))

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
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new Error('Desktop auth token must be a non-empty string.')
  }
  return authTokenStore.set(token)
})
ipcMain.handle('obiter:clear-auth-token', () => authTokenStore.clear())

const windowBackground = nativeTheme.shouldUseDarkColors ? '#1a1612' : '#f4efe4'

function registerRendererProtocol() {
  const rendererRoot = join(__dirname, '../renderer')

  protocol.handle('obiter', async (request) => {
    let requestPath: string
    try {
      requestPath = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad Request', { status: 400 })
    }

    const resolved = resolveRendererPath(rendererRoot, requestPath)
    if (resolved === null) {
      return new Response('Forbidden', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(resolved).toString())
    } catch {
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
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const allowedOrigin = parseAllowedOrigin(
    process.env.ELECTRON_RENDERER_URL ?? 'obiter://desktop-auth',
  )

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(allowedOrigin, url)) {
      event.preventDefault()
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
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
