import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type { DocumentPdfViewResponse } from '@obiter/contracts'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { DocumentPdfPages } from './pdf-view'

/**
 * A stored layout whose segments alternate across three pages. Each page's
 * text ends with a sentinel the tests use to prove only the current page's
 * spans ever mount — the DOM work is bounded by a page, not the document.
 */
function viewWith(pages: number): DocumentPdfViewResponse {
  const segments: DocumentPdfViewResponse['layout']['segments'] = []
  let text = ''
  for (let page = 0; page < pages; page += 1) {
    for (let row = 0; row < 4; row += 1) {
      const line = `page ${String(page + 1)} line ${String(row + 1)} sentinel-${String(page)}`
      const start = text.length
      text += `${line}\n`
      segments.push({
        start,
        end: start + line.length,
        pageIndex: page,
        x: 72,
        y: 720 - row * 18,
        width: 200,
        height: 12,
      })
    }
  }
  return {
    documentId: 'doc_1',
    versionId: 'ver_1',
    versionNumber: 1,
    text,
    layout: {
      version: 1,
      pages: Array.from({ length: pages }, () => ({
        width: 612,
        height: 792,
      })),
      segments,
    },
  }
}

function renderPages(pageIndex = 0) {
  const onPageIndexChange = vi.fn()
  render(
    <DocumentPdfPages
      view={viewWith(3)}
      pageIndex={pageIndex}
      onPageIndexChange={onPageIndexChange}
      zoom={100}
    />,
  )
  return onPageIndexChange
}

describe('DocumentPdfPages', () => {
  it('mounts only the current page’s segments', () => {
    renderPages(0)
    expect(screen.getAllByText(/sentinel-0/)).toHaveLength(4)
    expect(screen.queryByText(/sentinel-1/)).toBeNull()
    expect(screen.queryByText(/sentinel-2/)).toBeNull()
  })

  it('disables the edge controls at the document ends', () => {
    const { rerender } = render(
      <DocumentPdfPages
        view={viewWith(3)}
        pageIndex={0}
        onPageIndexChange={() => undefined}
        zoom={100}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Previous page' }),
    ).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty(
      'disabled',
      false,
    )

    rerender(
      <DocumentPdfPages
        view={viewWith(3)}
        pageIndex={2}
        onPageIndexChange={() => undefined}
        zoom={100}
      />,
    )
    expect(screen.getByRole('button', { name: 'Next page' })).toHaveProperty(
      'disabled',
      true,
    )
  })

  it('navigates with previous and next inside the bounds', () => {
    const onPageIndexChange = renderPages(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageIndexChange).toHaveBeenCalledWith(2)
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(onPageIndexChange).toHaveBeenCalledWith(0)
  })

  it('jumps to a typed page and refuses values outside the range', () => {
    const onPageIndexChange = renderPages(0)
    const jump = screen.getByRole('textbox', { name: /Go to page/ })
    fireEvent.change(jump, { target: { value: '3' } })
    fireEvent.keyDown(jump, { key: 'Enter' })
    expect(onPageIndexChange).toHaveBeenCalledWith(2)

    onPageIndexChange.mockClear()
    fireEvent.change(jump, { target: { value: '9' } })
    fireEvent.keyDown(jump, { key: 'Enter' })
    expect(onPageIndexChange).not.toHaveBeenCalled()

    fireEvent.change(jump, { target: { value: 'page two' } })
    fireEvent.keyDown(jump, { key: 'Enter' })
    expect(onPageIndexChange).not.toHaveBeenCalled()
  })

  it('says when the layout has no pages', () => {
    const view = viewWith(3)
    const empty: DocumentPdfViewResponse = {
      ...view,
      layout: { ...view.layout, pages: [], segments: [] },
    }
    render(
      <DocumentPdfPages
        view={empty}
        pageIndex={0}
        onPageIndexChange={() => undefined}
        zoom={100}
      />,
    )
    expect(screen.getByText(/no layout pages/i)).toBeTruthy()
  })
})
