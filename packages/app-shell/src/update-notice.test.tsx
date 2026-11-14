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
import {
  act,
  cleanup,
  fireEvent,
  render as renderWithoutClient,
  screen,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DesktopBridge } from './lib/desktop-bridge'
import { registerUpdateSave } from './update-saves'
import { AppUpdateNotice } from './update-notice'

type BridgeWindow = Window & { obiterDesktop?: Partial<DesktopBridge> }

const originalFetch = globalThis.fetch

const requested: string[] = []

function serveBuild(build: string | null, requireUpdates = false) {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    requested.push(url)
    if (url.includes('/update-policy')) return Response.json({ requireUpdates })
    return build === null
      ? new Response('not found', { status: 404 })
      : Response.json({ build })
  }) as unknown as typeof fetch
}

function render(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return renderWithoutClient(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  )
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
  requested.length = 0
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

  it('shows the reload prompt as visible text, not only an icon', async () => {
    serveBuild('b')
    render(<AppUpdateNotice platform="web" loadedBuild="a" />)
    await focusTab()
    const button = await screen.findByRole('button', {
      name: 'Update available. Reload to update',
    })
    expect(button.textContent).toBe('Reload to update')
  })

  it('never reloads the page by itself', async () => {
    serveBuild('b')
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
    render(<AppUpdateNotice platform="web" loadedBuild="a" />)
    await focusTab()
    await screen.findByRole('button', { name: /Update/ })
    expect(reload).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Update available. Reload to update',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
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

  it('offers a restart once the update is ready and never restarts by itself', async () => {
    const bridge = installBridge()
    render(<AppUpdateNotice platform="desktop" />)
    bridge.announce()
    expect(
      screen.getByRole('button', { name: 'Update ready. Restart to update' }),
    ).toBeTruthy()
    expect(bridge.restartToUpdate).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Update ready. Restart to update' }),
      )
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
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
    serveBuild('b', true)
    const unregister = registerUpdateSave(async () => false)
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      render(
        <AppUpdateNotice
          platform="web"
          loadedBuild="a"
          organisationId="org_1"
        />,
      )
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
    serveBuild('b', true)
    const order: string[] = []
    const unregister = registerUpdateSave(async () => {
      order.push('saved')
      return true
    })
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {
      order.push('reload')
    })
    try {
      render(
        <AppUpdateNotice
          platform="web"
          loadedBuild="a"
          organisationId="org_1"
        />,
      )
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

  it('asks for the policy only once an update is ready', async () => {
    serveBuild('a', true)
    render(
      <AppUpdateNotice platform="web" loadedBuild="a" organisationId="org_1" />,
    )
    await focusTab()
    expect(requested.some((url) => url.includes('/update-policy'))).toBe(false)
  })
})

describe('optional updates', () => {
  it('saves pending work before the icon reloads', async () => {
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
      render(
        <AppUpdateNotice
          platform="web"
          loadedBuild="a"
          organisationId="org_1"
        />,
      )
      await focusTab()
      await act(async () => {
        fireEvent.click(
          await screen.findByRole('button', { name: /Reload to update/ }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(order).toEqual(['saved', 'reload'])
    } finally {
      unregister()
      reload.mockRestore()
    }
  })

  it('keeps the page and says why when a save fails, and can be closed', async () => {
    serveBuild('b')
    const unregister = registerUpdateSave(async () => false)
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {})
    try {
      render(
        <AppUpdateNotice
          platform="web"
          loadedBuild="a"
          organisationId="org_1"
        />,
      )
      await focusTab()
      await act(async () => {
        fireEvent.click(
          await screen.findByRole('button', { name: /Reload to update/ }),
        )
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      const dialog = await screen.findByRole('dialog')
      expect(screen.getByRole('alert').textContent).toContain(
        'The update waits until your work is saved',
      )
      expect(reload).not.toHaveBeenCalled()
      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Escape' })
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      unregister()
      reload.mockRestore()
    }
  })
})
