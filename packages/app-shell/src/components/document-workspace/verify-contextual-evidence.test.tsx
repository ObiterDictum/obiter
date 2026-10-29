import '@obiter/test-dom'
// Which findings are drawn in the document, where they are drawn, and what
// happens when one is activated. Mapping and placement are the subject here;
// navigation, keyboard and version truthfulness live in the sibling suite.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { finding, mount, quoteFinding } from './verify-contextual-harness'

describe('contextual verification evidence', () => {
  it('opens contextual evidence from a mapped citation', async () => {
    mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation, Citation matches checked source/,
    })
    expect(marker.tagName).toBe('BUTTON')
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
    expect(panel.textContent).toContain('Citation matches checked source')
    // The version is named by number when it is known, never by its id.
    expect(panel.textContent).toContain('Checked the stored version.')
  })

  it('opens a quotation finding from the document', async () => {
    mount([quoteFinding()])
    const marker = await screen.findByRole('button', {
      name: /Quotation, Flagged/,
    })
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Flagged')
    expect(panel.textContent).toContain('[2012] UKSC 40')
  })

  it('keeps the panel out of the document layout so the page cannot reflow', async () => {
    mount([finding()])
    const desk = document.querySelector('[data-document-desk]')
    const flowBefore = desk?.children.length ?? 0
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Citation, Citation matches checked source/,
      }),
    )
    const panel = await screen.findByRole('dialog')
    expect(panel.closest('[data-document-desk]')).toBeNull()
    expect(desk?.children.length).toBe(flowBefore)
    // The marker layer is out of flow, so it cannot add a line, a margin or a
    // scroll height to the page it decorates.
    const layer = document.querySelector('[data-verification-layer]')
    expect(layer?.className).toContain('absolute')
  })

  it('never attaches a finding to text that no longer matches what was checked', async () => {
    mount([finding({ excerpt: '[2012] UKSC 9' })])
    await screen.findByRole('region', { name: 'Verification' })
    await waitFor(() => {
      expect(
        screen.queryByRole('button', {
          name: /Citation, Citation matches checked source/,
        }),
      ).toBeNull()
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'All findings' })[0]!)
    const index = await screen.findByRole('dialog')
    expect(index.textContent).toContain('Not shown in the document')
  })

  it('shows one marker per place, with the most serious outcome there', async () => {
    mount([
      finding(),
      finding({
        id: 'vf_1-existence',
        type: 'authority_existence',
        state: 'flagged',
        explanation: 'The stored sources do not hold this authority.',
      }),
    ])
    const markers = await screen.findAllByRole('button', {
      name: /^(Citation|Authority), /,
    })
    expect(markers).toHaveLength(1)
    expect(markers[0]!.getAttribute('aria-label')).toContain('Flagged')
    expect(markers[0]!.getAttribute('aria-label')).toContain('2 findings here')
    // The marker must open the most serious member it advertises, not whichever
    // member the API happened to list first.
    fireEvent.click(markers[0]!)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Flagged')
    expect(panel.textContent).toContain('Authority')
    expect(panel.textContent).not.toContain('Citation matches checked source')
  })
})
