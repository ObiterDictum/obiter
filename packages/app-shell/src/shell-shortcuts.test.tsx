import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { isTypingTarget, matchShellKey, ShortcutHint } from './shell-shortcuts'

const DEFAULT_PLATFORM = navigator.platform
const DEFAULT_USER_AGENT = navigator.userAgent

const MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'
const WINDOWS_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

function stubPlatform(platform: string, userAgent: string) {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'userAgent', {
    value: userAgent,
    configurable: true,
  })
}

function key(
  overrides: Partial<{
    key: string
    metaKey: boolean
    ctrlKey: boolean
    altKey: boolean
    defaultPrevented: boolean
    target: EventTarget | null
  }> = {},
) {
  return {
    key: 'j',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: document.body,
    ...overrides,
  }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  stubPlatform(DEFAULT_PLATFORM, DEFAULT_USER_AGENT)
})

describe('shell shortcuts', () => {
  it('maps the primary-modifier keys to the shell commands', () => {
    stubPlatform('Win32', WINDOWS_USER_AGENT)
    expect(matchShellKey(key({ key: '\\', ctrlKey: true }), false)).toEqual({
      kind: 'command',
      command: 'toggle-nav',
    })
    expect(matchShellKey(key({ key: 'j', ctrlKey: true }), false)).toEqual({
      kind: 'command',
      command: 'toggle-right-slot',
    })
    expect(matchShellKey(key({ key: '.', ctrlKey: true }), false)).toEqual({
      kind: 'command',
      command: 'focus-mode',
    })
  })

  it('takes ⌘ on a Mac and rejects Ctrl there', () => {
    stubPlatform('MacIntel', MAC_USER_AGENT)
    expect(matchShellKey(key({ key: 'j', metaKey: true }), false)).toEqual({
      kind: 'command',
      command: 'toggle-right-slot',
    })
    expect(matchShellKey(key({ key: 'j', ctrlKey: true }), false)).toBeNull()
  })

  it('waits for the second key of the go sequence', () => {
    expect(matchShellKey(key({ key: 'g' }), false)).toEqual({
      kind: 'sequence-start',
    })
    expect(matchShellKey(key({ key: 'm' }), true)).toEqual({
      kind: 'command',
      command: 'go-matters',
    })
    expect(matchShellKey(key({ key: 'm' }), false)).toBeNull()
  })

  it('ignores keys the editor or a dialog already claimed', () => {
    expect(
      matchShellKey(
        key({ key: 'j', metaKey: true, defaultPrevented: true }),
        false,
      ),
    ).toBeNull()
    expect(
      matchShellKey(key({ key: 'g', defaultPrevented: true }), false),
    ).toBeNull()
  })

  it('ignores bare letters while typing in a field', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(isTypingTarget(input)).toBe(true)
    expect(matchShellKey(key({ key: 'g', target: input }), false)).toBeNull()
    expect(matchShellKey(key({ key: 'm', target: input }), true)).toBeNull()
  })

  it('still runs primary-modifier shortcuts from a text field', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(
      matchShellKey(key({ key: 'j', ctrlKey: true, target: input }), false),
    ).toEqual({
      kind: 'command',
      command: 'toggle-right-slot',
    })
  })

  it('shows the keys it matches on Windows and on a Mac', () => {
    stubPlatform('Win32', WINDOWS_USER_AGENT)
    render(<ShortcutHint command="toggle-right-slot" />)
    expect(screen.getAllByText('Ctrl')).toHaveLength(1)
    expect(screen.getAllByText('j')).toHaveLength(1)

    cleanup()
    stubPlatform('MacIntel', MAC_USER_AGENT)
    render(<ShortcutHint command="toggle-right-slot" />)
    expect(screen.getAllByText('⌘')).toHaveLength(1)
    expect(screen.getAllByText('j')).toHaveLength(1)
  })
})
