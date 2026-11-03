import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { isTypingTarget, matchShellKey, shortcutParts } from './shell-shortcuts'

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
  document.body.innerHTML = ''
})

describe('shell shortcuts', () => {
  it('maps the primary-modifier keys to the shell commands', () => {
    expect(matchShellKey(key({ key: '\\', metaKey: true }), false)).toEqual({
      kind: 'command',
      command: 'toggle-nav',
    })
    expect(matchShellKey(key({ key: 'j', ctrlKey: true }), false)).toEqual({
      kind: 'command',
      command: 'toggle-right-slot',
    })
    expect(matchShellKey(key({ key: '.', metaKey: true }), false)).toEqual({
      kind: 'command',
      command: 'focus-mode',
    })
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
      matchShellKey(key({ key: 'j', metaKey: true, target: input }), false),
    ).toEqual({
      kind: 'command',
      command: 'toggle-right-slot',
    })
  })

  it('shows the same keys it matches', () => {
    expect(shortcutParts('toggle-right-slot')).toEqual([
      expect.stringMatching(/^(⌘|Ctrl)$/),
      'j',
    ])
    expect(shortcutParts('go-verify')).toEqual(['g', 'v'])
  })
})
