import '@obiter/test-dom'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import type { RightSlotTabId } from './right-slot'

mock.module('./agent-panel', () => ({
  AgentTab: () => <p>Agent content</p>,
}))

const { RightSlot, availableRightSlotTabs } = await import('./right-slot')
const { RightSlotPortal, RightSlotPortalProvider, useRightSlotTarget } =
  await import('./right-slot-portal')

const DOCUMENT_PATH = '/matters/mtr_1/documents/doc_1'

function Harness({
  pathname,
  initialTab = 'agent',
  page = null,
}: {
  pathname: string
  initialTab?: RightSlotTabId
  page?: ReactNode
}) {
  const [tab, setTab] = useState<RightSlotTabId>(initialTab)
  return (
    <RightSlotPortalProvider>
      {page}
      <p data-testid="stored-tab">{tab}</p>
      <RightSlot pathname={pathname} tab={tab} onTabChange={setTab} />
    </RightSlotPortalProvider>
  )
}

function ChecksProbe() {
  const target = useRightSlotTarget('checks')
  return <p data-testid="checks-shown">{target ? 'shown' : 'hidden'}</p>
}

afterEach(() => cleanup())

describe('right slot registry', () => {
  it('lists only the Agent tab on routes that are not a document', () => {
    for (const path of [
      '/',
      '/matters',
      '/matters/mtr_1',
      '/matters/mtr_1/verify',
      '/search',
      '/verify',
      '/settings',
    ]) {
      expect(availableRightSlotTabs(path).map((tab) => tab.id)).toEqual([
        'agent',
      ])
    }
  })

  it('lists Agent, Comments, Checks and History on a matter document route', () => {
    expect(availableRightSlotTabs(DOCUMENT_PATH).map((tab) => tab.id)).toEqual([
      'agent',
      'comments',
      'checks',
      'history',
    ])
  })

  it('renders only the tabs the route registers', () => {
    render(<Harness pathname="/matters/mtr_1" />)
    expect(screen.getByRole('tab', { name: 'Agent' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Comments' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Checks' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'History' })).toBeNull()
  })

  it('falls back to Agent when the remembered tab is not registered on the route', async () => {
    render(<Harness pathname="/matters/mtr_1" initialTab="checks" />)
    expect(
      await screen.findByRole('complementary', { name: 'Agent panel' }),
    ).toBeTruthy()
    expect(screen.getByTestId('stored-tab').textContent).toBe('checks')
  })
})

describe('right slot document tabs', () => {
  it('shows what the document page renders into the open tab', () => {
    render(
      <Harness
        pathname={DOCUMENT_PATH}
        initialTab="checks"
        page={
          <RightSlotPortal tab="checks">
            <p>Two defined-term findings</p>
          </RightSlotPortal>
        }
      />,
    )
    const panel = screen.getByRole('complementary', { name: 'Checks panel' })
    expect(panel.textContent).toContain('Two defined-term findings')
  })

  it('renders nothing from the page into a tab that is not open', () => {
    render(
      <Harness
        pathname={DOCUMENT_PATH}
        initialTab="comments"
        page={
          <>
            <ChecksProbe />
            <RightSlotPortal tab="checks">
              <p>Two defined-term findings</p>
            </RightSlotPortal>
          </>
        }
      />,
    )
    expect(screen.queryByText('Two defined-term findings')).toBeNull()
    expect(screen.getByTestId('checks-shown').textContent).toBe('hidden')
  })

  it('tells the page a tab is shown so it computes the tab only while open', () => {
    render(
      <Harness
        pathname={DOCUMENT_PATH}
        initialTab="checks"
        page={<ChecksProbe />}
      />,
    )
    expect(screen.getByTestId('checks-shown').textContent).toBe('shown')
  })

  it('says the document is opening until the page fills the tab', () => {
    render(<Harness pathname={DOCUMENT_PATH} initialTab="history" />)
    expect(screen.getByText('Opening the document…')).toBeTruthy()
  })

  it('remembers the tab chosen with a click', () => {
    render(<Harness pathname={DOCUMENT_PATH} />)
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByTestId('stored-tab').textContent).toBe('history')
    expect(
      screen.getByRole('complementary', { name: 'History panel' }),
    ).toBeTruthy()
  })

  it('keeps only the open tab in the tab order so Tab leaves the tab list in one step', () => {
    render(<Harness pathname={DOCUMENT_PATH} initialTab="checks" />)
    const list = screen.getByRole('tablist', { name: 'Panel tabs' })
    const tabs = screen.getAllByRole('tab')
    expect(tabs.every((tab) => list.contains(tab))).toBe(true)
    const inOrder = tabs.filter((tab) => tab.getAttribute('tabindex') === '0')
    expect(inOrder.map((tab) => tab.textContent)).toEqual(['Checks'])
    expect(
      screen.getByRole('tab', { name: 'Checks' }).getAttribute('aria-selected'),
    ).toBe('true')
  })

  it('fits four tabs in the 330px panel by showing only the open tab by name', () => {
    render(<Harness pathname={DOCUMENT_PATH} initialTab="checks" />)
    const open = screen.getByRole('tab', { name: 'Checks' })
    expect(within(open).getByText('Checks').className).not.toContain('sr-only')
    for (const name of ['Agent', 'Comments', 'History']) {
      const closed = screen.getByRole('tab', { name })
      expect(within(closed).getByText(name).className).toContain('sr-only')
    }
  })

  it('names a closed tab in a tooltip when it takes focus', async () => {
    render(<Harness pathname={DOCUMENT_PATH} initialTab="checks" />)
    const history = screen.getByRole('tab', { name: 'History' })
    history.focus()
    expect((await screen.findByRole('tooltip')).textContent).toBe('History')
  })
})
