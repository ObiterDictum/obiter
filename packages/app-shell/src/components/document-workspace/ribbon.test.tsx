// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentRibbon, PdfRibbon } from './ribbon'
import type { DocumentFormatToolbar } from './ribbon'

const format: DocumentFormatToolbar = {
  paragraphStyleId: '',
  paragraphStyles: [
    { styleId: 'Heading1', name: 'Heading 1' },
    { styleId: 'Normal', name: 'Normal' },
  ],
  bold: false,
  italic: false,
  underline: false,
  canIndent: true,
  canOutdent: true,
  canContinue: false,
  bulletList: false,
  numberList: false,
  canToggleLists: true,
  onParagraphStyle: () => undefined,
  onToggleBold: () => undefined,
  onToggleItalic: () => undefined,
  onToggleUnderline: () => undefined,
  onIndent: () => undefined,
  onOutdent: () => undefined,
  onContinueList: () => undefined,
  onToggleBullets: () => undefined,
  onToggleNumbers: () => undefined,
}

function mountRibbon(
  overrides: Partial<Parameters<typeof DocumentRibbon>[0]> = {},
) {
  return render(
    <DocumentRibbon
      dirty
      saving={false}
      trackChanges={false}
      zoom={100}
      commentsOpen={false}
      changesOpen={false}
      commentCount={2}
      changeCount={1}
      presence={[]}
      onToggleComments={() => undefined}
      onToggleChanges={() => undefined}
      onToggleTrackChanges={() => undefined}
      onZoom={() => undefined}
      onExportText={() => undefined}
      onSave={() => undefined}
      onUndo={() => undefined}
      onInsertParagraph={() => undefined}
      onDeleteParagraph={() => undefined}
      canUndo
      canEdit
      format={format}
      {...overrides}
    />,
  )
}

afterEach(cleanup)

describe('DocumentRibbon', () => {
  it('shows Home formatting controls with the tab strip', () => {
    mountRibbon()
    expect(
      screen.getByRole('tab', { name: 'Home', selected: true }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy()
    expect(screen.getByLabelText('Paragraph style')).toBeTruthy()
    expect(screen.getByLabelText('Font')).toBeTruthy()
    expect(screen.getByLabelText('Align left (not available yet)')).toBeTruthy()
  })

  it('marks reserved tabs as coming soon without activating them', () => {
    mountRibbon()
    expect(screen.queryByRole('tab', { name: 'Design' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'References' })).toBeNull()
    expect(screen.getByText('Design', { exact: false })).toBeTruthy()
  })

  it('toggles bullet formatting from the ribbon', () => {
    const onToggleBullets = vi.fn()
    mountRibbon({
      format: { ...format, onToggleBullets, bulletList: true },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Bullets' }))
    expect(onToggleBullets).toHaveBeenCalledTimes(1)
  })

  it('keeps find controls visible on every tab', () => {
    mountRibbon({
      find: {
        query: 'term',
        matchLabel: '1/2',
        onQuery: () => undefined,
        onNext: () => undefined,
        onPrevious: () => undefined,
      },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    expect(screen.getByLabelText('Find in document')).toBeTruthy()
    expect(screen.getByText('1/2')).toBeTruthy()
  })

  it('moves review controls behind the Review tab', () => {
    const onToggleTrackChanges = vi.fn()
    mountRibbon({ onToggleTrackChanges })
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
    expect(onToggleTrackChanges).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Comments' })).toBeTruthy()
  })

  it('keeps zoom and export on the View tab with presence', () => {
    const onZoom = vi.fn()
    const onExportText = vi.fn()
    mountRibbon({
      onZoom,
      onExportText,
      presence: [{ userId: 'user_elaine', cursor: null }],
      currentUserId: 'user_karl',
    })
    fireEvent.click(screen.getByRole('tab', { name: 'View' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(onZoom).toHaveBeenCalledWith(110)
    fireEvent.click(screen.getByRole('button', { name: 'Export document' }))
    expect(onExportText).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Editors present')).toBeTruthy()
  })
})

describe('PdfRibbon', () => {
  it('offers zoom and export only', () => {
    const onZoom = vi.fn()
    render(
      <PdfRibbon zoom={100} onZoom={onZoom} onExportText={() => undefined} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    expect(onZoom).toHaveBeenCalledWith(90)
    expect(screen.getByRole('button', { name: 'Export text' })).toBeTruthy()
    expect(screen.getByText('View only, not editable')).toBeTruthy()
  })
})
