import '@obiter/test-dom'
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { ReviewRibbon } from './ribbon-review'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

const ribbonProps = {
  canEdit: true,
  trackChanges: false,
  commentsOpen: false,
  changesOpen: false,
  commentCount: 0,
  changeCount: 0,
  onToggleComments: () => {},
  onToggleChanges: () => {},
  onToggleTrackChanges: () => {},
  onExportText: () => {},
}

afterEach(() => vi.unstubAllGlobals())

function disabled(button: HTMLElement) {
  if (!(button instanceof HTMLButtonElement)) throw new Error('Expected button')
  return button.disabled
}

function version(id: string, versionNumber: number, fileType = 'docx') {
  return {
    id,
    versionNumber,
    fileType,
    documentStatus: 'ready',
    filename: `${id}.${fileType}`,
  }
}

function mountWithVersions(versions: ReturnType<typeof version>[]) {
  const fetch = vi
    .fn()
    .mockResolvedValue(Response.json({ document: { id: 'doc_1' }, versions }))
  vi.stubGlobal('fetch', fetch)
  mountWorkspace({
    models: { doc_1: multiParagraphModel([paragraph('p1', 'Hello')]) },
  })
  fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
  return fetch
}

describe('Compare versions in the editor', () => {
  it('honestly gates an absent handler', () => {
    render(<ReviewRibbon {...ribbonProps} />)
    expect(
      disabled(
        screen.getByRole('button', {
          name: 'Compare versions (not available yet)',
        }),
      ),
    ).toBe(true)
  })

  it('dispatches an available handler', () => {
    const onCompareVersions = vi.fn()
    render(
      <ReviewRibbon {...ribbonProps} onCompareVersions={onCompareVersions} />,
    )
    const button = screen.getByRole('button', { name: 'Compare versions' })
    expect(disabled(button)).toBe(false)
    fireEvent.click(button)
    expect(onCompareVersions).toHaveBeenCalledTimes(1)
  })

  it('opens the stored versions in the workspace and closes the dialog', async () => {
    const fetch = mountWithVersions([
      version('new', 3),
      version('old', 2),
      version('pdf', 1, 'pdf'),
    ])
    const button = await screen.findByRole('button', {
      name: 'Compare versions',
    })
    fireEvent.click(button)
    const dialog = await screen.findByRole('dialog', {
      name: 'Compare stored versions',
    })
    const pickers = within(dialog).getAllByRole('combobox')
    expect(pickers.map((picker) => picker.textContent)).toEqual([
      'v2 · old.docx',
      'v3 · new.docx',
    ])
    expect(within(dialog).queryByText('v1 · pdf.pdf')).toBeNull()
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/documents/doc_1')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
