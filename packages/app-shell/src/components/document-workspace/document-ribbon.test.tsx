import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  commandDisabled,
  setTrackChanges,
  trackChangesState,
} from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

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
  Object.defineProperty(window.navigator, 'userAgentData', {
    value: undefined,
    configurable: true,
  })
}

afterEach(() => {
  stubPlatform(DEFAULT_PLATFORM, DEFAULT_USER_AGENT)
})

function mountDocument() {
  return mountWorkspace({
    models: { doc_1: multiParagraphModel([paragraph('p1', 'Hello')]) },
  })
}

function tab(name: string) {
  return screen.getByRole('tab', { name })
}

function tabs() {
  return within(
    screen.getByRole('tablist', { name: 'Ribbon tabs' }),
  ).getAllByRole('tab')
}

describe('ribbon tabs', () => {
  it('selects the Format tab by default and only one tab at a time', () => {
    mountDocument()

    expect(
      tabs().map((element) => element.getAttribute('aria-selected')),
    ).toEqual(['false', 'false', 'true', 'false', 'false'])
    expect(screen.getByRole('tabpanel', { name: 'Format' })).toBeTruthy()
  })

  it('switches the ribbon panel to the tab that was clicked', () => {
    mountDocument()

    fireEvent.click(tab('Insert'))

    expect(tab('Insert').getAttribute('aria-selected')).toBe('true')
    expect(tab('Format').getAttribute('aria-selected')).toBe('false')
    const panel = screen.getByRole('tabpanel', { name: 'Insert' })
    expect(within(panel).getByRole('button', { name: 'Insert table' }))
    expect(within(panel).queryByRole('button', { name: 'Bold' })).toBeNull()
  })

  it('moves between tabs with the arrow keys and wraps at the ends', () => {
    mountDocument()
    tab('Format').focus()

    fireEvent.keyDown(tab('Format'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Review'))
    expect(tab('Review').getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(tab('Review'), { key: 'End' })
    expect(document.activeElement).toBe(tab('View'))

    fireEvent.keyDown(tab('View'), { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tab('Edit'))

    fireEvent.keyDown(tab('Edit'), { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tab('View'))
  })

  it('keeps one tab in the tab order as the selected tab moves', () => {
    mountDocument()

    fireEvent.click(tab('View'))

    expect(tabs().map((element) => element.getAttribute('tabindex'))).toEqual([
      '-1',
      '-1',
      '-1',
      '-1',
      '0',
    ])
  })

  it('keeps Save, Undo and Redo in the ribbon on every tab', () => {
    mountDocument()

    for (const name of ['Edit', 'Insert', 'Review', 'View']) {
      fireEvent.click(tab(name))
      for (const command of ['Save', 'Undo', 'Redo']) {
        expect(screen.getByRole('button', { name: command })).toBeTruthy()
      }
    }
  })

  it('keeps the File menu as a menu of document commands, not a ribbon tab', () => {
    mountDocument()

    expect(screen.queryByRole('tab', { name: 'File' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'File' }))

    const menu = screen.getByRole('menu', { name: 'File' })
    expect(within(menu).getByRole('menuitem', { name: 'Print' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Export' })).toBeTruthy()
  })
})

describe('ribbon commands', () => {
  it('shows a disabled command reason as its tooltip instead of a description line', () => {
    mountDocument()
    fireEvent.click(tab('Insert'))

    const insertTable = screen.getByRole('button', { name: 'Insert table' })
    expect(insertTable.hasAttribute('disabled')).toBe(true)
    expect(insertTable.getAttribute('title')).toBe(
      'Place the cursor in a paragraph to insert',
    )
  })

  it('renders a command hosted in the font panel only once', () => {
    mountDocument()

    expect(screen.queryByRole('button', { name: 'Strikethrough' })).toBeNull()
    expect(
      screen.getByRole('combobox', { name: 'Paragraph style' }),
    ).toBeTruthy()
  })
})

describe('ribbon track changes', () => {
  it('shows the on-state in the quick access row when the version tracks revisions', () => {
    mountWorkspace({
      models: {
        doc_1: {
          ...multiParagraphModel([paragraph('p1', 'Hello')]),
          trackRevisions: true,
        },
      },
    })

    expect(screen.getByText('Track changes on')).toBeTruthy()
  })

  it('turns tracking on from the Review tab and shows the indicator', async () => {
    mountDocument()

    expect(screen.queryByText('Track changes on')).toBeNull()
    setTrackChanges(true)

    await waitFor(() => expect(trackChangesState()).toBe('true'))
    expect(screen.getByText('Track changes on')).toBeTruthy()
  })

  it('keeps the verify status and both verify actions in the Review tab', () => {
    mountDocument()

    fireEvent.click(tab('Review'))

    expect(
      screen
        .getByRole('button', { name: 'Track changes' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(screen.getByRole('button', { name: 'Verify citations' }))
    expect(screen.getByRole('button', { name: 'Check citations' }))
  })
})

describe('ribbon platform shortcuts', () => {
  it('shows the command glyph for All commands on a Mac', async () => {
    stubPlatform('MacIntel', MAC_USER_AGENT)
    mountDocument()

    const button = screen.getByRole('button', { name: 'All commands' })
    expect(button.querySelector('kbd')).toBeNull()
    expect(button.querySelector('svg')).toBeTruthy()
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K')

    fireEvent.focus(button)
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'All commands (⌘K)',
    )
  })

  it('shows the platform keycap for All commands off a Mac', async () => {
    stubPlatform('Win32', WINDOWS_USER_AGENT)
    mountDocument()

    const button = screen.getByRole('button', { name: 'All commands' })
    expect(button.querySelector('svg')).toBeNull()
    expect(button.textContent).toBe('Ctrl+K')
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K')

    fireEvent.focus(button)
    expect((await screen.findByRole('tooltip')).textContent).toBe(
      'All commands (Ctrl+K)',
    )
  })
})

describe('ribbon collapsed groups', () => {
  it('keeps every table structure command in the Table tools menu', () => {
    mountDocument()
    fireEvent.click(tab('Insert'))

    const panel = screen.getByRole('tabpanel', { name: 'Insert' })
    expect(
      within(panel).getByRole('button', { name: 'Insert table' }),
    ).toBeTruthy()

    fireEvent.click(within(panel).getByRole('button', { name: 'Table tools' }))
    const menu = screen.getByRole('menu', { name: 'Table tools' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual([
      'Insert row above',
      'Insert row below',
      'Insert column left',
      'Insert column right',
      'Delete row',
      'Delete column',
      'Delete table',
    ])
  })

  it('keeps the reason a collapsed command is unavailable on its menu item', () => {
    mountDocument()
    fireEvent.click(tab('Insert'))
    fireEvent.click(
      within(screen.getByRole('tabpanel', { name: 'Insert' })).getByRole(
        'button',
        { name: 'Table tools' },
      ),
    )

    const menu = screen.getByRole('menu', { name: 'Table tools' })
    const insertRow = within(menu).getByRole('menuitem', {
      name: 'Insert row above',
    })
    expect(commandDisabled(insertRow)).toBe(true)
    expect(
      within(insertRow).getByText('Place the cursor in a table cell'),
    ).toBeTruthy()
  })

  it('keeps the authorities commands in the Authorities menu', () => {
    mountDocument()
    fireEvent.click(tab('Insert'))
    fireEvent.click(
      within(screen.getByRole('tabpanel', { name: 'Insert' })).getByRole(
        'button',
        { name: 'Authorities' },
      ),
    )

    const menu = screen.getByRole('menu', { name: 'Authorities' })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.getAttribute('aria-label')),
    ).toEqual([
      'Insert authority',
      'Table of authorities',
      'Update table of authorities',
      'Mark defined term',
    ])
  })
})
