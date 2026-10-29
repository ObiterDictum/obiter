import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { openRibbonTab } from './editor-test-commands'
import {
  fetchDocumentExport,
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  selectBodyParagraph,
  command,
} from './docx-workspace-harness'

describe('DocxWorkspace print', () => {
  it('offers an enabled Print control that opens the platform print dialog', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    mountWorkspace({})
    openRibbonTab('Review')
    const button = command('Print')
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    expect(print).toHaveBeenCalledTimes(1)
    expect(fetchDocumentExport).not.toHaveBeenCalled()
    print.mockRestore()
  })

  it('prints the on-screen state, including unsaved and pending text', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const editAsync = vi.fn()
    mountWorkspace({
      editAsync,
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Alpha'),
          paragraph('p2', 'Omega'),
        ]),
      },
    })
    selectBodyParagraph('Alpha')

    const editor = screen.getByLabelText('Paragraph text')
    fireEvent.change(editor, { target: { value: 'Alpha edited' } })
    expect(
      document.querySelector('[data-caret-run-overlay]')?.textContent,
    ).toContain('Alpha edited')

    editor.focus()
    fireEvent.keyDown(editor, { key: 'Enter' })
    fireEvent.change(screen.getByLabelText('Pending paragraph text'), {
      target: { value: 'Inserted paragraph' },
    })

    openRibbonTab('Review')
    fireEvent.click(command('Print'))

    expect(print).toHaveBeenCalledTimes(1)
    expect(
      document.querySelector('[data-document-desk]')?.textContent,
    ).toContain('Alpha edited')
    expect(
      document.querySelector('[data-document-desk]')?.textContent,
    ).toContain('Inserted paragraph')
    expect(editAsync).not.toHaveBeenCalled()
    expect(
      screen.getByLabelText<HTMLTextAreaElement>('Pending paragraph text')
        .value,
    ).toBe('Inserted paragraph')
    print.mockRestore()
  })

  it('surfaces a failed print rather than staying silent', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      throw new Error('printer offline')
    })
    mountWorkspace({})
    openRibbonTab('Review')
    fireEvent.click(command('Print'))
    expect(screen.getByText('Printing failed: printer offline')).toBeTruthy()
    print.mockRestore()
  })

  it('surfaces an absent print capability rather than staying silent', () => {
    const original = window.print
    Object.defineProperty(window, 'print', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    try {
      mountWorkspace({})
      openRibbonTab('Review')
      fireEvent.click(command('Print'))
      expect(
        screen.getByText('Printing is not available in this environment.'),
      ).toBeTruthy()
    } finally {
      Object.defineProperty(window, 'print', {
        value: original,
        configurable: true,
        writable: true,
      })
    }
  })

  it('sizes the printed sheet from the document page box', () => {
    mountWorkspace({})
    expect(
      document.querySelector('style[data-document-print]')?.textContent,
    ).toBe('@page{size:8.2708in 11.6979in;margin:0}')
  })

  it('keeps the document paper size in @page while the web layout is painted', () => {
    mountWorkspace({})
    openRibbonTab('View')
    fireEvent.click(command('Web layout'))

    expect(
      document.querySelector('style[data-document-print]')?.textContent,
    ).toBe('@page{size:8.2708in 11.6979in;margin:0}')
    expect(
      document.querySelector('style[data-document-print]')?.textContent,
    ).not.toContain('104166')
  })

  it('repaginates to paper sheets before the dialog and restores afterprint', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel(
          Array.from({ length: 60 }, (_, index) =>
            paragraph(`p${index}`, `Line ${index}`),
          ),
        ),
      },
    })
    openRibbonTab('View')
    fireEvent.click(command('Web layout'))
    const webSheet = document.querySelector('[data-document-sheet]')
    expect(webSheet?.className).toContain('bg-transparent')

    openRibbonTab('Review')
    fireEvent.click(command('Print'))

    expect(print).toHaveBeenCalledTimes(1)
    expect(
      document.querySelectorAll('[data-document-sheet].bg-white').length,
    ).toBeGreaterThan(1)
    expect(
      document.querySelector('[data-document-sheet].bg-transparent'),
    ).toBeNull()

    fireEvent(window, new Event('afterprint'))
    const restored = document.querySelector('[data-document-sheet]')
    expect(restored?.className).toContain('bg-transparent')
    print.mockRestore()
  })

  it('repaginates for a browser-initiated print too', () => {
    mountWorkspace({})
    openRibbonTab('View')
    fireEvent.click(command('Web layout'))

    fireEvent(window, new Event('beforeprint'))
    expect(
      document.querySelectorAll('[data-document-sheet].bg-white').length,
    ).toBeGreaterThan(0)
    fireEvent(window, new Event('afterprint'))
    expect(
      document.querySelector('[data-document-sheet]')?.className,
    ).toContain('bg-transparent')
  })

  it('restores the web layout when the platform cannot print', () => {
    const original = window.print
    Object.defineProperty(window, 'print', {
      value: undefined,
      configurable: true,
      writable: true,
    })
    try {
      mountWorkspace({})
      openRibbonTab('View')
      fireEvent.click(command('Web layout'))

      openRibbonTab('Review')
      fireEvent.click(command('Print'))

      expect(
        screen.getByText('Printing is not available in this environment.'),
      ).toBeTruthy()
      expect(
        document.querySelector('[data-document-sheet]')?.className,
      ).toContain('bg-transparent')
    } finally {
      Object.defineProperty(window, 'print', {
        value: original,
        configurable: true,
        writable: true,
      })
    }
  })
})
