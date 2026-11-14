import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PageScaffold } from './page-scaffold'
import { ContentsPanel } from './contents-panel'
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

function renderPanel({
  expanded,
  overlay = false,
}: {
  expanded: boolean
  overlay?: boolean
}) {
  let toggles = 0
  render(
    <PagePanelProvider
      panel={{
        name: 'matters list',
        expanded,
        controls: 'app-shell-contents',
        toggle: () => {
          toggles += 1
        },
      }}
    >
      <ContentsPanel section="home" pathname="/" overlay={overlay} />
      <PageScaffold title="Matters">
        <p>Body</p>
      </PageScaffold>
    </PagePanelProvider>,
  )
  return () => toggles
}

function pageHeader() {
  return screen.getByRole('heading', { level: 1 }).closest('header')
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
})

describe('section panel toggle', () => {
  it('puts the hide control at the far right of the panel header while the panel is open', () => {
    renderPanel({ expanded: true })
    const panel = screen.getByRole('complementary', { name: 'Home' })
    const hide = screen.getByRole('button', { name: 'Hide matters list' })
    expect(panel.contains(hide)).toBe(true)
    expect(hide.parentElement?.lastElementChild).toBe(hide)
    expect(hide.getAttribute('aria-controls')).toBe('app-shell-contents')
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    expect(pageHeader()?.contains(hide)).toBe(false)
    expect(
      screen.queryByRole('button', { name: 'Show matters list' }),
    ).toBeNull()
  })

  it('keeps the hide control in the panel header while the panel overlays the page', () => {
    renderPanel({ expanded: true, overlay: true })
    const panel = screen.getByRole('complementary', { name: 'Home' })
    const hide = screen.getByRole('button', { name: 'Hide matters list' })
    expect(panel.contains(hide)).toBe(true)
    expect(pageHeader()?.contains(hide)).toBe(false)
  })

  it('shows only the show control beside the title while the panel is collapsed, and it reopens the panel', () => {
    const toggles = renderPanel({ expanded: false })
    const title = screen.getByRole('heading', { level: 1 })
    const show = screen.getByRole('button', { name: 'Show matters list' })
    expect(title.parentElement?.contains(show)).toBe(true)
    expect(show.getAttribute('aria-expanded')).toBe('false')
    expect(
      screen.queryByRole('button', { name: 'Hide matters list' }),
    ).toBeNull()
    fireEvent.click(show)
    expect(toggles()).toBe(1)
  })

  it('keeps the show control beside the title while the overlay panel is closed', () => {
    renderPanel({ expanded: false, overlay: true })
    const title = screen.getByRole('heading', { level: 1 })
    const show = screen.getByRole('button', { name: 'Show matters list' })
    expect(title.parentElement?.contains(show)).toBe(true)
    expect(
      screen.queryByRole('button', { name: 'Hide matters list' }),
    ).toBeNull()
  })

  it('renders no panel toggle on a page with no section panel', () => {
    renderScaffold()
    expect(screen.queryByRole('button', { name: /^(Hide|Show) / })).toBeNull()
  })
})
