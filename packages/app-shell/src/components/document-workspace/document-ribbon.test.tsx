import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { setTrackChanges, trackChangesState } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

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
