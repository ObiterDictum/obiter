import '@obiter/test-dom'
// Moving between findings, reaching the ones the document cannot show, the
// keyboard path, the responsive fallback and the stored-version boundary.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import {
  finding,
  hardBreakFinding,
  mount,
  quoteFinding,
  setStoredVersionId,
  setUnsavedWork,
  unmappableFinding,
  workspaceElement,
} from './verify-contextual-harness'

describe('contextual verification evidence', () => {
  it('navigates between mapped findings while keeping the document context', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    const panel = await screen.findByRole('dialog')
    fireEvent.click(await screen.findByRole('button', { name: 'Next finding' }))
    await waitFor(() => {
      expect(panel.textContent).toContain('[2012] UKSC 40')
    })
    // The document target follows the selection.
    await waitFor(() => {
      const active = document.querySelector('[data-verification-active]')
      expect(active?.getAttribute('data-verification-paragraph-id')).toBe('p2')
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'Previous finding' }),
    )
    await waitFor(() => {
      expect(panel.textContent).toContain('[2012] UKSC 7')
    })
  })

  it('closes on a document-level Escape and restores focus to the originating marker', async () => {
    mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation resolution, Clear/,
    })
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    // Move focus into the panel as a keyboard user would. The document-level
    // listener, not the marker's own handler, must close it and restore focus.
    ;(panel.querySelector('button') as HTMLButtonElement).focus()
    expect(document.activeElement).not.toBe(marker)
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(document.activeElement).toBe(marker)
  })

  it('keeps the panel through a real pointerdown inside the findings index', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    // A real pointerdown, not a click: the panel's dismissal listener must not
    // treat the modal index as outside it. The modal aria-hides the panel while
    // it is open, so assert the element survives rather than staying exposed.
    fireEvent.pointerDown(index)
    expect(document.querySelector('[data-verification-panel]')).toBeTruthy()
    expect(screen.queryByText('All findings')).toBeTruthy()
    // Escape inside the index closes only the index; the panel returns with the
    // same finding selected.
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByText('All findings')).toBeNull()
    })
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
  })

  it('opens a finding from an index row and closes the index', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: 'View all findings' }),
    )
    const index = await screen.findByRole('dialog')
    fireEvent.click(within(index).getByText(quoteFinding().explanation))
    await waitFor(() => {
      expect(screen.queryByText('All findings')).toBeNull()
    })
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 40')
  })

  it('does not carry selection or markers across a same-pane document switch', async () => {
    const view = mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation resolution, Clear/,
    })
    fireEvent.click(marker)
    await screen.findByRole('dialog')
    expect(document.querySelector('[data-verification-active]')).toBeTruthy()
    view.rerender(workspaceElement('doc_2'))
    // The panel and the active marker from document A must not survive into
    // document B, even though the finding and paragraph ids overlap.
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[data-verification-active]')).toBeNull()
  })

  it('does not present a hard-break excerpt as a text change', async () => {
    mount([hardBreakFinding()])
    await screen.findByRole('region', { name: 'Verification' })
    expect(
      screen.queryByRole('button', { name: /Quote fidelity, Flagged/ }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('line break')
    expect(index.textContent).not.toContain(
      'differs from the text that was checked',
    )
  })

  it('does not read a run of not-checked findings as all-clear', async () => {
    mount([finding({ state: 'not_checked' })], {
      summary: { findingCount: 1, flaggedCount: 0, reviewRequiredCount: 1 },
    })
    const dock = await screen.findByRole('region', { name: 'Verification' })
    expect(dock.textContent).toContain('1 not checked')
    expect(dock.textContent).toContain('Review required (1)')
    expect(dock.textContent).not.toContain('No findings need attention')
  })

  it('keeps an unmappable finding reachable with a stated reason', async () => {
    mount([finding(), unmappableFinding()])
    await screen.findByRole('button', { name: /Citation resolution, Clear/ })
    expect(
      screen.queryByRole('button', { name: /Authority existence.*2099/ }),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('Not shown in the document')
  })

  it('does not present text edited since the check as verified', async () => {
    setUnsavedWork(true)
    mount([finding()])
    const dock = await screen.findByRole('region', {
      name: 'Verification',
    })
    expect(dock.textContent).toContain('Stored version')
    expect(dock.textContent).toContain('unsaved')
    expect(
      (
        screen.getByRole('button', {
          name: 'Run verification',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('stored version ver_1')
    expect(panel.textContent).toContain(
      'Unsaved edits are not part of the stored version',
    )
  })

  it('falls back to a drawer when the viewport cannot fit the panel', async () => {
    mount([finding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    await screen.findByRole('dialog')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 420,
    })
    fireEvent(window, new Event('resize'))
    await waitFor(() => {
      expect(screen.getByRole('dialog').getAttribute('data-placement')).toBe(
        'drawer',
      )
    })
  })

  it('keeps the selected finding when the index opens and returns', async () => {
    mount([finding(), quoteFinding()])
    fireEvent.click(
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
    )
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('All findings')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
  })

  it('marks evidence as earlier than the document once a newer version is stored', async () => {
    setStoredVersionId('ver_2')
    mount([finding()])
    const dock = await screen.findByRole('region', { name: 'Verification' })
    expect(await screen.findByText('Earlier version')).toBeTruthy()
    expect(dock.textContent).toContain('Stored version ver_1')
  })

  it('moves focus to the run status when a run starts', async () => {
    mount([finding()])
    const start = await screen.findByRole('button', {
      name: 'Run verification',
    })
    fireEvent.click(start)
    expect(document.activeElement?.getAttribute('role')).toBe('status')
  })

  it('shows totals, the next actionable finding and the stored version', async () => {
    mount([finding(), quoteFinding(), unmappableFinding()])
    const dock = await screen.findByRole('region', { name: 'Verification' })
    expect(dock.textContent).toContain('1 clear · 1 flagged · 1 needs review')
    expect(dock.textContent).toContain('ver_1')
    fireEvent.click(screen.getByRole('button', { name: 'Go to next finding' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
  })
})
