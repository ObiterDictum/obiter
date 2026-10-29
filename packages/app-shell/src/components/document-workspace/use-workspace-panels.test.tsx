import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import {
  closesPanelOnEscape,
  useWorkspacePanels,
  type WorkspacePanel,
} from './use-workspace-panels'

function Harness() {
  const panels = useWorkspacePanels()
  const [focused, setFocused] = useState<string | null>(null)
  return (
    <div>
      {(
        ['info', 'comments', 'review', 'authorities', 'legal-checks'] as const
      ).map((panel: WorkspacePanel) => (
        <button
          key={panel}
          type="button"
          data-panel={panel}
          onClick={() => panels.toggle(panel)}
        >
          Open {panel}
        </button>
      ))}
      <input aria-label="Document text" data-paragraph-id="p1" />
      {panels.active ? (
        <aside data-docked-panel aria-label={panels.active}>
          <button type="button" onClick={panels.close}>
            Close
          </button>
          <input aria-label="Panel field" onFocus={() => setFocused('panel')} />
          {focused}
        </aside>
      ) : null}
    </div>
  )
}

describe('useWorkspacePanels', () => {
  it('keeps one docked panel open at a time', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open comments' }))
    expect(screen.getByRole('complementary', { name: 'comments' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open review' }))
    expect(screen.queryByRole('complementary', { name: 'comments' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'review' })).toBeTruthy()
  })

  it('returns focus to the control that opened the panel when it closes', () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open comments' })
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(trigger)
  })

  it('does not take the Escape key from the document text', () => {
    expect(closesPanelOnEscape(screen.queryByRole('textbox'))).toBe(true)
    const { container } = render(<Harness />)
    const paragraph = container.querySelector('[data-paragraph-id]')
    expect(closesPanelOnEscape(paragraph)).toBe(false)
    expect(closesPanelOnEscape(document.body)).toBe(true)
  })

  it('leaves Escape to an open menu', () => {
    render(
      <div role="menu" aria-label="File">
        <button type="button" role="menuitem">
          Export
        </button>
      </div>,
    )
    expect(closesPanelOnEscape(screen.getByRole('menuitem'))).toBe(false)
  })
})
