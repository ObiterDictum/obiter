import '@obiter/test-dom'
import { afterEach, expect, it, mock, spyOn } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AgentComposer } from './agent-composer'
import { conversationTitle } from '../agent-sessions'

let calls: Array<{ url: string; body: unknown }> = []
let conflict = false
const sonnet = {
  id: 'claude-sonnet-5-5',
  provider: 'anthropic',
  label: 'Claude Sonnet 5.5',
  description: 'Balanced research',
  thinkingLevels: ['off', 'low', 'medium', 'high'],
  defaultThinking: 'medium',
} as const
const opus = {
  id: 'claude-opus-5-5',
  provider: 'anthropic',
  label: 'Claude Opus 5.5',
  description: 'Deep analysis',
  thinkingLevels: ['low', 'medium', 'high'],
  defaultThinking: 'medium',
} as const
let models: Array<typeof sonnet | typeof opus> = [sonnet]
function setup(matterId: string | null = null, live = false) {
  calls = []
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith('/api/agent/models'))
          return Response.json({
            models,
            default: 'claude-sonnet-5-5',
            defaultThinking: 'medium',
          })
        calls.push({
          url,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        })
        if (url.endsWith('/turns'))
          return Response.json(
            conflict
              ? {
                  error: {
                    code: 'conflict',
                    message: 'Busy',
                    requestId: 'req_test',
                  },
                }
              : { run: {} },
            { status: conflict ? 409 : 202 },
          )
        return Response.json({ session: { id: 's1' } })
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  )
  const sent = mock()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentComposer matterId={matterId} live={live} onSent={sent} />
    </QueryClientProvider>,
  )
  return sent
}
afterEach(() => {
  cleanup()
  mock.restore()
  conflict = false
  models = [sonnet]
})
it('creates a private session and posts its first turn before handing off to the thread', async () => {
  const sent = setup()
  const message = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(message, { target: { value: 'Explain negligence' } })
  fireEvent.keyDown(message, { key: 'Enter', shiftKey: true })
  expect(calls).toHaveLength(0)
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled'),
    ).toBe(false),
  )
  fireEvent.keyDown(message, { key: 'Enter' })
  await waitFor(() => expect(sent).toHaveBeenCalledWith('s1'))
  expect(calls.map((call) => call.body)).toEqual([
    {
      model: 'claude-sonnet-5-5',
      thinking: 'medium',
      matterId: null,
      title: 'Explain negligence',
      mode: 'supervised',
      idempotencyKey: expect.any(String),
    },
    {
      model: 'claude-sonnet-5-5',
      thinking: 'medium',
      kind: 'follow_up',
      text: 'Explain negligence',
      idempotencyKey: expect.any(String),
    },
  ])
})
it('disables messages while a run is live and explains why', async () => {
  setup(null, true)
  expect(
    screen.getByRole('textbox', { name: 'Message' }).hasAttribute('disabled'),
  ).toBe(true)
  expect(
    (await screen.findByRole('button', { name: 'Sonnet 5.5' })).hasAttribute(
      'disabled',
    ),
  ).toBe(true)
  expect(screen.getByText(/Wait for the current answer/)).toBeTruthy()
})
it('shows conflicts inline and reuses the turn key on retry without recreating the session', async () => {
  conflict = true
  const sent = setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explain negligence' },
  })
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled'),
    ).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'An answer is already in progress',
  )
  const first = calls[1]?.body
  conflict = false
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled'),
    ).toBe(false),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith('s1'))
  expect(calls).toHaveLength(3)
  expect(calls[2]?.body).toEqual(first)
})
it('opens one menu with a model row and a Think longer switch that leaves the menu open', async () => {
  setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Sonnet 5.5' }))
  const menu = await screen.findByRole('dialog', {
    name: 'Model and thinking',
  })
  expect(
    screen
      .getByRole('radio', { name: /Sonnet 5.5/ })
      .getAttribute('aria-checked'),
  ).toBe('true')
  const toggle = screen.getByRole('switch', { name: 'Think longer' })
  expect(toggle.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(toggle)
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  expect(menu.isConnected).toBe(true)
  expect(
    screen.getByRole('button', { name: 'Sonnet 5.5 · Think longer' }),
  ).toBeTruthy()
})

it('keeps Think longer on when the model changes and sends high for the new model', async () => {
  models = [sonnet, opus]
  const sent = setup()
  fireEvent.click(await screen.findByRole('button', { name: 'Sonnet 5.5' }))
  fireEvent.click(await screen.findByRole('switch', { name: 'Think longer' }))
  fireEvent.click(await screen.findByRole('radio', { name: /Opus 5.5/ }))
  await screen.findByRole('button', { name: 'Opus 5.5 · Think longer' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explain negligence' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith('s1'))
  expect(calls[0]?.body).toMatchObject({
    model: 'claude-opus-5-5',
    thinking: 'high',
  })
})

it('trims conversation titles at a word boundary within eighty characters', () => {
  expect(conversationTitle('  short title  ')).toBe('short title')
  expect(conversationTitle('word '.repeat(20))).toBe(
    'word '.repeat(15) + 'word',
  )
})
it('keeps the Message name with a hidden label and grows the editor up to eight lines', () => {
  setup()
  const message = screen.getByRole('textbox', { name: 'Message' })
  expect(screen.getByText('Message').className).toBe('sr-only')
  Object.defineProperty(message, 'scrollHeight', {
    configurable: true,
    value: 120,
  })
  fireEvent.change(message, { target: { value: 'A\nB\nC' } })
  expect(message.style.height).toBe('120px')
  Object.defineProperty(message, 'scrollHeight', {
    configurable: true,
    value: 400,
  })
  fireEvent.change(message, { target: { value: 'Longer question' } })
  expect(message.style.height).toBe('192px')
})

it('invites questions about the matter inside a matter and about the law elsewhere', () => {
  setup('mtr_1')
  expect(
    screen
      .getByRole('textbox', { name: 'Message' })
      .getAttribute('placeholder'),
  ).toBe('Ask about this matter…')
  cleanup()
  setup()
  expect(
    screen
      .getByRole('textbox', { name: 'Message' })
      .getAttribute('placeholder'),
  ).toBe('Ask about case law or legislation…')
})
