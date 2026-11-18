import '@obiter/test-dom'
import { act, cleanup, render } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  BOT_CHECK_TIMEOUT_MS,
  BotCheck,
  type BotCheckHandle,
  type BotCheckState,
} from './bot-check'

type Callbacks = {
  callback?: (token: string) => void
  'error-callback'?: () => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  'before-interactive-callback'?: () => void
}

function installFakeTurnstile() {
  const widget: { options?: Callbacks } = {}
  const fake = {
    render: vi.fn((_element: HTMLElement, options: Callbacks) => {
      widget.options = options
      return 'widget-1'
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = fake
  return { fake, widget }
}

async function renderBotCheck() {
  const states: BotCheckState['status'][] = []
  const handle = createRef<BotCheckHandle>()
  const view = render(
    <BotCheck
      ref={handle}
      siteKey="site-key"
      action="request-access"
      onChange={(state) => states.push(state.status)}
    />,
  )
  await act(async () => {})
  return { states, handle, view }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.turnstile
})

describe('bot check', () => {
  it('gives up waiting for a token after the deadline', async () => {
    installFakeTurnstile()
    const { states } = await renderBotCheck()
    expect(states).toEqual(['pending'])

    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS - 1))
    expect(states).toEqual(['pending'])
    act(() => vi.advanceTimersByTime(1))
    expect(states).toEqual(['pending', 'unavailable'])
  })

  it('stops the deadline once a token arrives', async () => {
    const { widget } = installFakeTurnstile()
    const { states } = await renderBotCheck()

    act(() => widget.options?.callback?.('token-1'))
    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS * 2))
    expect(states).toEqual(['pending', 'passed'])
  })

  it.each([
    ['error-callback' as const],
    ['expired-callback' as const],
    ['timeout-callback' as const],
  ])('reports the check as failed on %s', async (name) => {
    const { widget } = installFakeTurnstile()
    const { states } = await renderBotCheck()

    act(() => widget.options?.[name]?.())
    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS))
    expect(states).toEqual(['pending', 'unavailable'])
  })

  it('does not time out while the visitor is answering an interactive challenge', async () => {
    const { widget } = installFakeTurnstile()
    const { states } = await renderBotCheck()

    act(() => widget.options?.['before-interactive-callback']?.())
    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS * 2))
    expect(states).toEqual(['pending'])
  })

  it('rearms the deadline when reset after a failure', async () => {
    const { fake, widget } = installFakeTurnstile()
    const { states, handle } = await renderBotCheck()

    act(() => widget.options?.['error-callback']?.())
    act(() => handle.current?.reset())
    expect(fake.reset).toHaveBeenCalledWith('widget-1')
    expect(states).toEqual(['pending', 'unavailable', 'pending'])

    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS))
    expect(states).toEqual(['pending', 'unavailable', 'pending', 'unavailable'])
  })

  it('clears the deadline and removes the widget on unmount', async () => {
    const { fake } = installFakeTurnstile()
    const { states, view } = await renderBotCheck()

    view.unmount()
    act(() => vi.advanceTimersByTime(BOT_CHECK_TIMEOUT_MS))
    expect(fake.remove).toHaveBeenCalledWith('widget-1')
    expect(states).toEqual(['pending'])
  })
})
