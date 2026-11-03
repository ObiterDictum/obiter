import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  formatShortcut,
  isMacPlatform,
  isPrimaryModifier,
  modifierLabels,
  primaryModifierLabel,
  shortcutLabels,
} from './keyboard-platform'

const DEFAULT_PLATFORM = navigator.platform
const DEFAULT_USER_AGENT = navigator.userAgent

const MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const WINDOWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

function stubNavigator(
  platform: string,
  userAgent: string,
  userAgentDataPlatform?: string,
) {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'userAgentData', {
    value:
      userAgentDataPlatform === undefined
        ? undefined
        : { platform: userAgentDataPlatform },
    configurable: true,
  })
}

function stubDesktopBridge(osPlatform: string) {
  Object.defineProperty(window, 'obiterDesktop', {
    value: { osPlatform },
    configurable: true,
  })
}

afterEach(() => {
  stubNavigator(DEFAULT_PLATFORM, DEFAULT_USER_AGENT)
  delete (window as Window & { obiterDesktop?: unknown }).obiterDesktop
})

describe('keyboard platform', () => {
  it('labels the primary modifier ⌘ on a Mac browser and Ctrl on Windows', () => {
    stubNavigator('MacIntel', MAC_USER_AGENT)
    expect(isMacPlatform()).toBe(true)
    expect(primaryModifierLabel()).toBe('⌘')

    stubNavigator('Win32', WINDOWS_USER_AGENT)
    expect(isMacPlatform()).toBe(false)
    expect(primaryModifierLabel()).toBe('Ctrl')
  })

  it('takes the desktop bridge platform over the browser user agent', () => {
    stubNavigator('Win32', WINDOWS_USER_AGENT)
    stubDesktopBridge('darwin')
    expect(isMacPlatform()).toBe(true)

    stubNavigator('MacIntel', MAC_USER_AGENT)
    stubDesktopBridge('linux')
    expect(isMacPlatform()).toBe(false)
  })

  it('reads userAgentData before navigator.platform and the user agent', () => {
    stubNavigator('Win32', WINDOWS_USER_AGENT, 'macOS')
    expect(isMacPlatform()).toBe(true)

    stubNavigator('MacIntel', MAC_USER_AGENT, 'Windows')
    expect(isMacPlatform()).toBe(false)
  })

  it('falls back to the user agent when the platform strings are empty', () => {
    stubNavigator('', '')
    expect(isMacPlatform()).toBe(false)

    stubNavigator('', MAC_USER_AGENT)
    expect(isMacPlatform()).toBe(true)
  })

  it('joins Mac modifier glyphs without separators and other platforms with +', () => {
    expect(formatShortcut(['primary', 'shift', 'Z'], true)).toBe('⌘⇧Z')
    expect(formatShortcut(['primary', 'shift', 'Z'], false)).toBe(
      'Ctrl+Shift+Z',
    )
    expect(modifierLabels(true)).toEqual({ primary: '⌘', shift: '⇧', alt: '⌥' })
    expect(modifierLabels(false)).toEqual({
      primary: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
    })
    expect(shortcutLabels(['primary', 'alt', 'K'], true)).toEqual([
      '⌘',
      '⌥',
      'K',
    ])
  })

  it('takes only the platform primary modifier as primary', () => {
    stubNavigator('MacIntel', MAC_USER_AGENT)
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(true)
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(false)

    stubNavigator('Win32', WINDOWS_USER_AGENT)
    expect(isPrimaryModifier({ metaKey: false, ctrlKey: true })).toBe(true)
    expect(isPrimaryModifier({ metaKey: true, ctrlKey: false })).toBe(false)
  })
})
