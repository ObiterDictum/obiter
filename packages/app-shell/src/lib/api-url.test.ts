import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { apiUrl, resolvePackagedApiOrigin } from './api-url'
import type { DesktopBridge } from './desktop-bridge'

type WindowWithBridge = Window & { obiterDesktop?: DesktopBridge }

describe('apiUrl', () => {
  afterEach(() => {
    delete (window as WindowWithBridge).obiterDesktop
  })

  it('returns a relative path when no packaged origin is exposed', () => {
    expect(apiUrl('/api/matters')).toBe('/api/matters')
  })

  it('returns an absolute URL against the packaged origin when the bridge exposes one', () => {
    Object.defineProperty(window as WindowWithBridge, 'obiterDesktop', {
      value: {
        apiOrigin: 'https://api.obiter.dev',
        platform: 'desktop',
        shellVersion: 'x',
      },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe('https://api.obiter.dev/api/matters')
  })

  it('ignores a blank packaged origin and falls back to relative', () => {
    Object.defineProperty(window as WindowWithBridge, 'obiterDesktop', {
      value: { apiOrigin: '', platform: 'desktop', shellVersion: 'x' },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe('/api/matters')
    expect(resolvePackagedApiOrigin()).toBeNull()
  })

  it('ignores a non-string packaged origin and falls back to relative', () => {
    Object.defineProperty(window as WindowWithBridge, 'obiterDesktop', {
      value: { apiOrigin: undefined, platform: 'desktop', shellVersion: 'x' },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe('/api/matters')
    expect(resolvePackagedApiOrigin()).toBeNull()
  })
})
