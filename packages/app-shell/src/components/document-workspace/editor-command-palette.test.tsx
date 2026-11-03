import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { EditorCommandPalette } from './editor-command-palette'
import type { EditorMenu } from './editor-commands'

const DEFAULT_PLATFORM = navigator.platform
const DEFAULT_USER_AGENT = navigator.userAgent

const MAC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36'

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

const menus: readonly EditorMenu[] = [
  {
    id: 'file',
    label: 'File',
    groups: [
      {
        label: 'Document',
        commands: [{ id: 'save', label: 'Save', shortcut: ['primary', 'S'] }],
      },
    ],
  },
]

function openPalette() {
  render(
    <EditorCommandPalette open onOpenChange={() => undefined} menus={menus} />,
  )
}

afterEach(() => {
  cleanup()
  stubPlatform(DEFAULT_PLATFORM, DEFAULT_USER_AGENT)
})

describe('the editor command palette', () => {
  it('lists the shortcuts with Mac glyphs on a Mac', () => {
    stubPlatform('MacIntel', MAC_USER_AGENT)
    openPalette()
    const help = screen.getByLabelText('Keyboard shortcuts')
    expect(help.textContent).toContain('⇧')
    expect(help.textContent).not.toContain('Ctrl')
    expect(help.textContent).not.toContain('Shift')
  })

  it('writes the shortcuts with words elsewhere', () => {
    stubPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    openPalette()
    const help = screen.getByLabelText('Keyboard shortcuts')
    expect(help.textContent).toContain('Ctrl')
    expect(help.textContent).toContain('Shift')
    expect(help.textContent).not.toContain('⌘')
    expect(help.textContent).not.toContain('⇧')
  })

  it('shows a command shortcut in the platform it runs on', () => {
    stubPlatform('MacIntel', MAC_USER_AGENT)
    openPalette()
    expect(screen.getByRole('button', { name: /Save/ }).textContent).toContain(
      '⌘S',
    )

    cleanup()
    stubPlatform('Win32', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
    openPalette()
    expect(screen.getByRole('button', { name: /Save/ }).textContent).toContain(
      'Ctrl+S',
    )
  })
})
