import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  fetchDocumentExport,
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
  selectBodyParagraph,
} from './docx-workspace-harness'

describe('DocxWorkspace print', () => {
  it('offers an enabled Print control that opens the platform print dialog', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    mountWorkspace({})
    openRibbonTab('Review')
    const button = screen.getByRole('button', { name: 'Print' })
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    expect(print).toHaveBeenCalledTimes(1)
    // Printing is not the DOCX export and never reaches the server.
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

    // Unsaved text in the focused paragraph is painted by the run overlay the
    // print stylesheet keeps, even though the editor field itself is the
    // transparent textarea.
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
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))

    expect(print).toHaveBeenCalledTimes(1)
    // The edited paragraph is now painted statically, still carrying the draft.
    expect(
      document.querySelector('[data-document-desk]')?.textContent,
    ).toContain('Alpha edited')
    // The pending insert is mirrored as static content for the printed sheet,
    // where a form control is not reliable.
    expect(
      document.querySelector('[data-document-desk]')?.textContent,
    ).toContain('Inserted paragraph')
    // Printing neither saves nor clears any draft.
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
    fireEvent.click(screen.getByRole('button', { name: 'Print' }))
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
      fireEvent.click(screen.getByRole('button', { name: 'Print' }))
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
})
