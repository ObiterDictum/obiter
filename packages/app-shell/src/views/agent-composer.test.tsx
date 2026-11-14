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
function setup(live = false) {
  calls = []
  spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input)
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
      <AgentComposer matterId={null} live={live} onSent={sent} />
    </QueryClientProvider>,
  )
  return sent
}
afterEach(() => {
  cleanup()
  mock.restore()
  conflict = false
})
it('creates a private session and posts its first turn before handing off to the thread', async () => {
  const sent = setup()
  const message = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(message, { target: { value: 'Explain negligence' } })
  fireEvent.keyDown(message, { key: 'Enter', shiftKey: true })
  expect(calls).toHaveLength(0)
  fireEvent.keyDown(message, { key: 'Enter' })
  await waitFor(() => expect(sent).toHaveBeenCalledWith('s1'))
  expect(calls.map((call) => call.body)).toEqual([
    {
      matterId: null,
      title: 'Explain negligence',
      mode: 'supervised',
      idempotencyKey: expect.any(String),
    },
    {
      kind: 'follow_up',
      text: 'Explain negligence',
      idempotencyKey: expect.any(String),
    },
  ])
})
it('disables messages while a run is live and explains why', () => {
  setup(true)
  expect(
    screen.getByRole('textbox', { name: 'Message' }).hasAttribute('disabled'),
  ).toBe(true)
  expect(screen.getByText(/Wait for the current answer/)).toBeTruthy()
})
it('shows conflicts inline and reuses the turn key on retry without recreating the session', async () => {
  conflict = true
  const sent = setup()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
    target: { value: 'Explain negligence' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect((await screen.findByRole('alert')).textContent).toContain(
    'An answer is already in progress',
  )
  const first = calls[1]?.body
  conflict = false
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(sent).toHaveBeenCalledWith('s1'))
  expect(calls).toHaveLength(3)
  expect(calls[2]?.body).toEqual(first)
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
