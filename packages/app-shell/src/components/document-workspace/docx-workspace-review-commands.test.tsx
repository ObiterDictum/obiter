import '@obiter/test-dom'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { openRibbonTab } from './editor-test-commands'
import {
  command,
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

const model = () =>
  multiParagraphModel([paragraph('p1', 'Alpha'), paragraph('p2', 'Bravo')])

function rightSlot() {
  return screen.queryByRole('complementary', { name: 'Right slot' })
}

function commentsButton() {
  openRibbonTab('Review')
  return screen.getByRole('button', { name: /^Comments/ })
}

describe('Review commands open the right panel', () => {
  it('opens the Comments tab of the right panel, not a second docked panel', () => {
    mountWorkspace({ models: { doc_1: model() } })
    expect(rightSlot()).toBeNull()

    fireEvent.click(commentsButton())

    const panel = rightSlot()
    expect(panel?.getAttribute('data-tab')).toBe('comments')
    expect(
      within(panel as HTMLElement).getByLabelText('New comment'),
    ).toBeTruthy()
    expect(screen.getAllByLabelText('New comment')).toHaveLength(1)
    expect(document.querySelector('[data-docked-panel]')).toBeNull()
  })

  it('shows the Comments command pressed while the Comments tab is open', () => {
    mountWorkspace({ models: { doc_1: model() }, rightSlot: 'comments' })
    expect(commentsButton().getAttribute('aria-pressed')).toBe('true')
  })

  it('closes the panel from the same command and returns focus to it', () => {
    mountWorkspace({ models: { doc_1: model() } })
    const trigger = commentsButton()
    trigger.focus()
    fireEvent.click(trigger)
    expect(rightSlot()).toBeTruthy()

    fireEvent.click(commentsButton())

    expect(rightSlot()).toBeNull()
    expect(document.activeElement).toBe(commentsButton())
  })

  it('closes a tab a Review command opened with Escape and returns focus to the command', () => {
    mountWorkspace({ models: { doc_1: model() } })
    const trigger = commentsButton()
    trigger.focus()
    fireEvent.click(trigger)
    expect(rightSlot()?.getAttribute('data-tab')).toBe('comments')

    fireEvent.keyDown(screen.getByLabelText('New comment'), { key: 'Escape' })

    expect(rightSlot()).toBeNull()
    expect(document.activeElement).toBe(commentsButton())
  })

  it('opens the Checks tab from Check defined terms and Check cross-references', () => {
    mountWorkspace({ models: { doc_1: model() } })

    fireEvent.click(command('Check defined terms'))
    expect(rightSlot()?.getAttribute('data-tab')).toBe('checks')
    expect(command('Check defined terms').getAttribute('aria-pressed')).toBe(
      'true',
    )

    fireEvent.click(command('Check cross-references'))
    expect(rightSlot()?.getAttribute('data-tab')).toBe('checks')
    expect(command('Check cross-references').getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(command('Check defined terms').getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(document.querySelector('[data-docked-panel]')).toBeNull()
  })
})
