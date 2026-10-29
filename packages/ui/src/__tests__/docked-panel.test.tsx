import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { clampPanelPosition, DockedPanel } from '../docked-panel'

describe('DockedPanel', () => {
  it('is a labelled region, not a dialog: the page stays available', () => {
    render(
      <>
        <button type="button">Keep editing</button>
        <DockedPanel title="Comments" onClose={() => {}}>
          <p>One open thread</p>
        </DockedPanel>
      </>,
    )
    expect(screen.getByRole('complementary', { name: 'Comments' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Keep editing' })).toBeTruthy()
  })

  it('closes through the header control', () => {
    const onClose = mock(() => {})
    render(
      <DockedPanel title="Comments" onClose={onClose}>
        <p>One open thread</p>
      </DockedPanel>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close Comments' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders a footer and a header action when asked', () => {
    render(
      <DockedPanel
        title="Tracked changes"
        onClose={() => {}}
        action={<span>3 changes</span>}
        footer={<button type="button">Accept selected</button>}
      >
        <p>Change 1</p>
      </DockedPanel>,
    )
    expect(screen.getByText('3 changes')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept selected' })).toBeTruthy()
  })
})

describe('clampPanelPosition', () => {
  it('keeps a floated panel inside the viewport margins', () => {
    expect(
      clampPanelPosition(
        { x: -100, y: -100 },
        { width: 1000, height: 800 },
        {
          width: 300,
          height: 200,
        },
      ),
    ).toEqual({ x: 8, y: 8 })
    expect(
      clampPanelPosition(
        { x: 900, y: 700 },
        { width: 1000, height: 800 },
        {
          width: 300,
          height: 200,
        },
      ),
    ).toEqual({ x: 692, y: 592 })
  })

  it('never floats a panel above the chrome edge', () => {
    expect(
      clampPanelPosition(
        { x: 50, y: 50 },
        { width: 1000, height: 800 },
        {
          width: 300,
          height: 200,
        },
        120,
      ),
    ).toEqual({ x: 50, y: 120 })
  })

  it('keeps a panel larger than the viewport at the minimum', () => {
    expect(
      clampPanelPosition(
        { x: 10, y: 10 },
        { width: 100, height: 100 },
        {
          width: 300,
          height: 200,
        },
      ),
    ).toEqual({ x: 8, y: 8 })
  })
})
