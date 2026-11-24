import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type { VerifyPanelRequest } from '../verification/verification-context'
import { useWorkspacePageActions } from './use-workspace-page-actions'
import { useWorkspacePanels } from './use-workspace-panels'
import { useWorkspaceView } from './use-workspace-view'

function Harness({ verifyRequest }: { verifyRequest?: VerifyPanelRequest }) {
  const workspace = useWorkspaceView()
  const panels = useWorkspacePanels()
  const page = useWorkspacePageActions(workspace, panels, verifyRequest)
  return (
    <div>
      <output data-testid="panel">{panels.active ?? 'none'}</output>
      <output data-testid="palette">{workspace.requests.palette}</output>
      <input aria-label="Matter name" />
      <button type="button" onClick={() => page.togglePanel('review')}>
        Toggle review
      </button>
    </div>
  )
}

function paletteCount() {
  return screen.getByTestId('palette').textContent
}

function activePanel() {
  return screen.getByTestId('panel').textContent
}

describe('workspace page actions', () => {
  it('opens the palette from a window key event', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true })
    expect(paletteCount()).toBe('1')
  })

  it('ignores the shortcut without the chord and inside a form field', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'p', shiftKey: true })
    fireEvent.keyDown(screen.getByLabelText('Matter name'), {
      key: 'p',
      ctrlKey: true,
      shiftKey: true,
    })
    expect(paletteCount()).toBe('0')
  })

  it('opens the verify panel once per routed request', () => {
    const { rerender } = render(
      <Harness verifyRequest={{ value: 'open', seq: 1 }} />,
    )
    expect(activePanel()).toBe('verify')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle review' }))
    expect(activePanel()).toBe('review')

    rerender(<Harness verifyRequest={{ value: 'open', seq: 1 }} />)
    expect(activePanel()).toBe('review')

    rerender(<Harness verifyRequest={{ value: 'run', seq: 2 }} />)
    expect(activePanel()).toBe('verify')
  })
})
