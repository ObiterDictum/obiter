import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { Suspense, act, use } from 'react'
import { createRoot } from 'react-dom/client'
import { preloadable } from './route-preload'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

describe('preloadable', () => {
  it('starts the import once however often it is read', async () => {
    let calls = 0
    const load = preloadable(async () => {
      calls += 1
      return 'module'
    })
    const first = load()
    expect(load()).toBe(first)
    await first
    expect(load()).toBe(first)
    expect(calls).toBe(1)
  })

  it('marks the module fulfilled so React can read it without suspending', async () => {
    const load = preloadable(async () => 'module')
    await load()
    expect(load()).toMatchObject({ status: 'fulfilled', value: 'module' })
  })

  it('retries the import after it fails', async () => {
    let calls = 0
    const load = preloadable(async () => {
      calls += 1
      if (calls === 1) throw new Error('offline')
      return 'module'
    })
    await load().then(
      () => undefined,
      () => undefined,
    )
    await expect(load()).resolves.toBe('module')
    expect(calls).toBe(2)
  })

  it('renders a warmed view on the first commit without the loading fallback', async () => {
    const load = preloadable(async () => ({ View: () => <p>document</p> }))
    await load()
    function Route() {
      const { View } = use(load())
      return <View />
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() => {
      root.render(
        <Suspense fallback={<p>loading</p>}>
          <Route />
        </Suspense>,
      )
    })
    expect(container.textContent).toBe('document')
    act(() => root.unmount())
  })
})
