// @vitest-environment jsdom
// Which findings are drawn in the document, where they are drawn, and what
// happens when one is activated. Mapping and placement are the subject here;
// navigation, keyboard and version truthfulness live in the sibling suite.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { finding, mount, quoteFinding } from './verify-contextual-harness'

describe('contextual verification evidence', () => {
  it('opens contextual evidence from a mapped citation', async () => {
    mount([finding()])
    const marker = await screen.findByRole('button', {
      name: /Citation resolution, Clear/,
    })
    expect(marker.tagName).toBe('BUTTON')
    fireEvent.click(marker)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('[2012] UKSC 7')
    expect(panel.textContent).toContain('Clear')
    expect(panel.textContent).toContain('stored version ver_1')
  })

  it('opens a quotation finding from the document', async () => {
    mount([quoteFinding()])
    const marker = await screen.findByRole('button', {
      name: /Quote fidelity, Flagged/,
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
      await screen.findByRole('button', { name: /Citation resolution, Clear/ }),
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
        screen.queryByRole('button', { name: /Citation resolution, Clear/ }),
      ).toBeNull()
    })
    fireEvent.click(screen.getByRole('button', { name: 'View all findings' }))
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
      name: /Citation resolution|Authority existence/,
    })
    expect(markers).toHaveLength(1)
    expect(markers[0]!.getAttribute('aria-label')).toContain('Flagged')
    expect(markers[0]!.getAttribute('aria-label')).toContain('2 findings here')
  })
})
