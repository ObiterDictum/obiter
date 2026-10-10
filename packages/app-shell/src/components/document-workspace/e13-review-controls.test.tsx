import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  bodyEditor,
  mountSaveWorkspace,
  openReviewTab,
} from './docx-workspace-save-harness'

function openViewTab() {
  fireEvent.click(screen.getByRole('tab', { name: 'View' }))
}

describe('E13 review and view controls', () => {
  it('toggles the browser dictionary onto the document column', () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    openReviewTab()

    const column = () =>
      document.querySelector('[data-document-desk] [spellcheck]')

    expect(column()?.getAttribute('spellcheck')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Spelling' }))
    expect(column()?.getAttribute('spellcheck')).toBe('true')
    // The toggle says what it does — local, not a correctness check.
    expect(screen.getByText(/not a legal correctness check/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Spelling' }))
    expect(column()?.getAttribute('spellcheck')).toBe('false')
  })

  it('swaps page sheets for a chromeless continuous flow', () => {
    mountSaveWorkspace({
      editAsync: vi.fn(),
      paragraphs: Array.from({ length: 30 }, (_, index) => `Line ${index}`),
    })
    openViewTab()

    expect(
      document.querySelectorAll('[data-document-sheet].bg-white').length,
    ).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Web layout' }))
    const sheets = document.querySelectorAll('[data-document-sheet]')
    expect(sheets.length).toBe(1)
    expect(sheets[0]?.className).toContain('bg-transparent')
    expect(
      screen
        .getByRole('button', { name: 'Web layout' })
        .getAttribute('aria-pressed'),
    ).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Print layout' }))
    expect(
      document.querySelectorAll('[data-document-sheet].bg-white').length,
    ).toBeGreaterThan(0)
  })

  it('shows a ruler bound to the page measure', () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    openViewTab()
    expect(document.querySelector('[data-document-ruler]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ruler' }))
    const ruler = document.querySelector('[data-document-ruler]')
    expect(ruler).not.toBeNull()
    expect(ruler?.getAttribute('aria-label')).toContain('Page width')
  })

  it('lists headings and moves the caret to the one picked', () => {
    mountSaveWorkspace({
      editAsync: vi.fn(),
      paragraphs: ['First heading', 'Body text', 'Second heading'],
      styleIds: ['Heading1', undefined, 'Heading1'],
    })
    openViewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Navigation pane' }))

    const items = document.querySelectorAll('[data-outline-item]')
    expect(items).toHaveLength(2)
    expect(items[0]?.textContent).toBe('First heading')
    expect(items[1]?.textContent).toBe('Second heading')

    fireEvent.click(items[1] as HTMLElement)
    expect(bodyEditor().value).toBe('Second heading')
    expect(items[1]?.getAttribute('aria-current') ?? 'true').toBe('true')
  })

  it('says when the document has no headings', () => {
    mountSaveWorkspace({ editAsync: vi.fn() })
    openViewTab()
    fireEvent.click(screen.getByRole('button', { name: 'Navigation pane' }))
    expect(document.querySelector('[data-navigation-pane]')).not.toBeNull()
    expect(screen.getByText(/no headings/i)).toBeTruthy()
  })
})
