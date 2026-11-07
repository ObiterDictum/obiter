import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { PageScaffold } from './page-scaffold'
import { PagePanelProvider } from './page-panel'

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

function renderPanelScaffold(
  panel: { expanded: boolean; overlay: boolean } = {
    expanded: true,
    overlay: false,
  },
) {
  render(
    <PagePanelProvider
      panel={{
        name: 'matters list',
        controls: 'app-shell-contents',
        toggle: () => {},
        ...panel,
      }}
    >
      <PageScaffold title="Matters">
        <p>Body</p>
      </PageScaffold>
    </PagePanelProvider>,
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
    const block = title.closest('div.min-w-0.flex-1')
    expect(block).not.toBeNull()
    expect(title.className).toContain('[text-wrap:balance]')
  })

  it('starts the actions at the left edge once they drop below the title', () => {
    renderScaffold()
    const actions = screen.getByRole('button', {
      name: 'New document',
    }).parentElement
    expect(actions?.className).toContain('@max-pane-wide:justify-start')
  })

  it('puts the section panel toggle on the title’s line rather than the action row', () => {
    renderPanelScaffold()
    const toggle = screen.getByRole('button', { name: 'Hide matters list' })
    expect(toggle.getAttribute('aria-controls')).toBe('app-shell-contents')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.parentElement?.contains(toggle)).toBe(true)
    expect(title.nextElementSibling).toBe(toggle)
  })

  it('moves the panel toggle into the panel header while the panel overlays the page', () => {
    renderPanelScaffold({ expanded: true, overlay: true })
    expect(
      screen.queryByRole('button', { name: 'Hide matters list' }),
    ).toBeNull()
  })

  it('keeps the show control beside the title while the overlay panel is closed', () => {
    renderPanelScaffold({ expanded: false, overlay: true })
    expect(
      screen.getByRole('button', { name: 'Show matters list' }),
    ).toBeTruthy()
  })

  it('renders no panel toggle on a page with no section panel', () => {
    renderScaffold()
    expect(screen.queryByRole('button', { name: /^(Hide|Show) / })).toBeNull()
  })
})
