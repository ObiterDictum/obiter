import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { PageScaffold } from './page-scaffold'

function renderScaffold() {
  render(
    <PageScaffold
      title="Northgate Foods v Brightwater Packaging"
      description="Supply agreement dispute."
      actions={<button type="button">New document</button>}
    >
      <p>Body</p>
    </PageScaffold>,
  )
}

afterEach(() => {
  cleanup()
})

describe('page header', () => {
  it('measures itself against the pane, not the window, so a narrow pane stacks it', () => {
    renderScaffold()
    const header = screen.getByRole('heading', { level: 1 }).closest('header')
    expect(header?.className).toContain('@max-pane-wide:flex-col')
    expect(header?.className).toContain('flex-wrap')
  })

  it('gives the title a full-width line of its own instead of a column of words', () => {
    renderScaffold()
    const title = screen.getByRole('heading', { level: 1 })
    const block = title.parentElement
    expect(block?.className).toContain('flex-1')
    expect(block?.className).toContain('min-w-0')
    expect(title.className).toContain('[text-wrap:balance]')
  })

  it('starts the actions at the left edge once they drop below the title', () => {
    renderScaffold()
    const actions = screen.getByRole('button', {
      name: 'New document',
    }).parentElement
    expect(actions?.className).toContain('@max-pane-wide:justify-start')
  })
})
