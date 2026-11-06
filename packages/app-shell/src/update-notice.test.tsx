import '@obiter/test-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DesktopBridge } from './lib/desktop-bridge'
import { registerUpdateSave } from './update-saves'
import { AppUpdateNotice } from './update-notice'

type BridgeWindow = Window & { obiterDesktop?: Partial<DesktopBridge> }

const originalFetch = globalThis.fetch

function serveBuild(build: string | null) {
  globalThis.fetch = mock(async () =>
    build === null
      ? new Response('not found', { status: 404 })
      : Response.json({ build }),
  ) as unknown as typeof fetch
}

async function focusTab() {
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  delete (window as BridgeWindow).obiterDesktop
})

describe('the web update notice', () => {
  it('stays hidden while the server runs the build the page loaded', async () => {
    serveBuild('a')
    render(<AppUpdateNotice platform="web" loadedBuild="a" />)
    await focusTab()
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('says a new version is available and offers a reload once the build changes', async () => {
    serveBuild('b')
    render(<AppUpdateNotice platform="web" loadedBuild="a" />)
    await focusTab()
    expect(
      await screen.findByRole('button', {
        name: 'Update available. Reload to update',
      }),
    ).toBeTruthy()
  })

  it('never reloads the page by itself', async () => {
    serveBuild('b')
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
    render(<AppUpdateNotice platform="web" loadedBuild="a" />)
    await focusTab()
    await screen.findByRole('button', { name: /Update/ })
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Update available. Reload to update',
      }),
    )
    expect(reload).toHaveBeenCalledTimes(1)
    reload.mockRestore()
  })

  it('does not poll a build that carries no id, such as the dev server', async () => {
    serveBuild('b')
    render(<AppUpdateNotice platform="web" loadedBuild={null} />)
    await focusTab()
    expect(globalThis.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })
})

describe('the desktop update notice', () => {
  function installBridge() {
    let announce: () => void = () => {}
    const unsubscribe = mock(() => {})
    const restartToUpdate = mock(async () => {})
    ;(window as BridgeWindow).obiterDesktop = {
      platform: 'desktop',
      onUpdateReady: (listener) => {
        announce = listener
        return unsubscribe
      },
      restartToUpdate,
    }
    return {
      announce: () => act(() => announce()),
      unsubscribe,
      restartToUpdate,
    }
  }

  it('stays hidden until an update has downloaded', () => {
    installBridge()
    render(<AppUpdateNotice platform="desktop" />)
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('offers a restart once the update is ready and never restarts by itself', () => {
    const bridge = installBridge()
    render(<AppUpdateNotice platform="desktop" />)
    bridge.announce()
    expect(
      screen.getByRole('button', { name: 'Update ready. Restart to update' }),
    ).toBeTruthy()
    expect(bridge.restartToUpdate).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Update ready. Restart to update' }),
    )
    expect(bridge.restartToUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not poll the web build route', () => {
    serveBuild('b')
    installBridge()
    render(<AppUpdateNotice platform="desktop" loadedBuild="a" />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('stops listening when the shell unmounts', () => {
    const bridge = installBridge()
    const view = render(<AppUpdateNotice platform="desktop" />)
    view.unmount()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('required updates', () => {
  it('cannot be dismissed and waits when a document save fails', async () => {
    serveBuild('b')
    const unregister = registerUpdateSave(async () => false)
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      render(<AppUpdateNotice platform="web" loadedBuild="a" requireUpdates />)
      await focusTab()
      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toContain(
        'Your organisation requires the latest version of Obiter.',
      )
      expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.getByRole('dialog')).toBeTruthy()
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(screen.getByRole('alert').textContent).toContain(
        'The update waits until your work is saved',
      )
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(reload).not.toHaveBeenCalled()
    } finally {
      unregister()
      reload.mockRestore()
    }
  })
  it('flushes pending saves before applying a required update', async () => {
    serveBuild('b')
    const order: string[] = []
    const unregister = registerUpdateSave(async () => {
      order.push('saved')
      return true
    })
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {
      order.push('reload')
    })
    try {
      render(<AppUpdateNotice platform="web" loadedBuild="a" requireUpdates />)
      await focusTab()
      await screen.findByRole('dialog')
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(order).toEqual(['saved', 'reload'])
    } finally {
      unregister()
      reload.mockRestore()
    }
  })
})
