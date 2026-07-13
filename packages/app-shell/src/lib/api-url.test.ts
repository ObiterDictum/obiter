// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { apiUrl, resolvePackagedApiOrigin } from './api-url'

/**
 * apiUrl() has three branches: packaged renderer (absolute, from the preload
 * bridge), browser (relative, proxied/same-origin), and SSR (absolute, from
 * env). The bridge is additive: web and dev-desktop never set it, so they keep
 * the relative behaviour. These tests pin that contract.
 */
describe('apiUrl', () => {
  afterEach(() => {
    delete (window as Partial<Window>).obiterDesktop
  })

  it('returns a relative path when no packaged origin is exposed', () => {
    expect(apiUrl('/api/matters')).toBe('/api/matters')
  })

  it('returns an absolute URL against the packaged origin when the bridge exposes one', () => {
    Object.defineProperty(window, 'obiterDesktop', {
      value: { apiOrigin: 'https://api.obiter.dev', platform: 'desktop', shellVersion: 'x' },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe(
      'https://api.obiter.dev/api/matters',
    )
  })

  it('ignores a blank packaged origin and falls back to relative', () => {
    Object.defineProperty(window, 'obiterDesktop', {
      value: { apiOrigin: '', platform: 'desktop', shellVersion: 'x' },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe('/api/matters')
    expect(resolvePackagedApiOrigin()).toBeNull()
  })

  it('ignores a non-string packaged origin and falls back to relative', () => {
    Object.defineProperty(window, 'obiterDesktop', {
      value: { apiOrigin: undefined, platform: 'desktop', shellVersion: 'x' },
      configurable: true,
    })

    expect(apiUrl('/api/matters')).toBe('/api/matters')
    expect(resolvePackagedApiOrigin()).toBeNull()
  })
})
