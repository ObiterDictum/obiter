import '@obiter/test-dom'
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
    fireEvent.click(markers[0]!)
    const panel = await screen.findByRole('dialog')
    expect(panel.textContent).toContain('Flagged')
    expect(panel.textContent).toContain('Authority')
    expect(panel.textContent).not.toContain('Citation matches checked source')
  })

  it('names the run once, as the Verify page does, then its time', async () => {
    mount([finding()])
    const region = await screen.findByRole('region', { name: 'Verification' })
    expect(region.textContent).toContain('Checked')
    expect(region.textContent).toMatch(/14 Sep\w* 2026, 00:00/u)
    expect(region.textContent).not.toContain('Completed')
  })
})
