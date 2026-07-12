import { app, nativeTheme, BrowserWindow, shell } from 'electron'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Page background for the Electron window, picked before the renderer loads
 * so the launch does not flash the wrong theme. These mirror the --obiter-bg
 * token values in packages/ui/src/tokens.css; the main process cannot read a
 * CSS variable, so the constants are kept in sync by hand. A theme change
 * mid-session still requires a relaunch to update this launch color — the
 * renderer's <html> background flips immediately in CSS.
 */
const windowBackground = nativeTheme.shouldUseDarkColors ? '#1a1612' : '#f4efe4'

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
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
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
