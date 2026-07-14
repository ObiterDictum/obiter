import { describe, expect, it } from 'vitest'
import { isAllowedNavigation, parseAllowedOrigin } from './navigation-guard'

/**
 * isAllowedNavigation is the privilege-escape boundary for the desktop window.
 * It must allow only the renderer's own origin and deny everything else —
 * especially the 'null'-origin trap where URL.origin on a non-special scheme
 * collapses to "null" and would match file:// or any arbitrary scheme.
 */
describe('isAllowedNavigation', () => {
  const packaged = parseAllowedOrigin('obiter://desktop-auth')
  const dev = parseAllowedOrigin('http://localhost:5173')

  it('parses the packaged obiter origin without collapsing to a null origin', () => {
    expect(packaged).toEqual({ protocol: 'obiter:', host: 'desktop-auth' })
  })

  it('allows the packaged origin to navigate to itself', () => {
    expect(
      isAllowedNavigation(packaged, 'obiter://desktop-auth/index.html'),
    ).toBe(true)
    expect(
      isAllowedNavigation(packaged, 'obiter://desktop-auth/assets/app.js'),
    ).toBe(true)
  })

  it('denies a file:// navigation (the null-origin trap)', () => {
    // new URL('file:///C:/Windows/system.ini').origin === 'null' on every
    // non-special scheme; the old .origin guard allowed this.
    expect(isAllowedNavigation(packaged, 'file:///Windows/system.ini')).toBe(
      false,
    )
  })

  it('denies a foreign custom scheme that shares the "null" origin', () => {
    // evil://desktop-auth/x has origin 'null' too; must not match obiter.
    expect(isAllowedNavigation(packaged, 'evil://desktop-auth/x')).toBe(false)
  })

  it('denies the right scheme on the wrong host', () => {
    expect(isAllowedNavigation(packaged, 'obiter://other-host/x')).toBe(false)
  })

  it('denies an unparseable target url', () => {
    expect(isAllowedNavigation(packaged, 'not a url')).toBe(false)
  })

  it('fails closed when the allowlist itself failed to parse', () => {
    expect(isAllowedNavigation(null, 'obiter://desktop-auth/index.html')).toBe(
      false,
    )
  })

  it('allows the dev origin to navigate to itself and denies others', () => {
    expect(isAllowedNavigation(dev, 'http://localhost:5173/sign-in')).toBe(true)
    expect(isAllowedNavigation(dev, 'http://localhost:5174/')).toBe(false)
    expect(isAllowedNavigation(dev, 'https://localhost:5173/')).toBe(false)
    expect(isAllowedNavigation(dev, 'obiter://desktop-auth/')).toBe(false)
  })
})
