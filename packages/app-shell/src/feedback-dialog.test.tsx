import '@obiter/test-dom'
import { expect, it, mock } from 'bun:test'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react'
import { vi } from '../../../scripts/test/vitest-compat'
const api = vi.fn()
const original = { ...(await import('./api')) }
mock.module('./api', () => ({ ...original, apiFetch: api }))
const { FeedbackDialog } = await import('./feedback-dialog')
it('keeps the message on failure and sends only allowed metadata', async () => {
  api.mockRejectedValueOnce(new Error('Please try again later.'))
  render(<FeedbackDialog onClose={() => undefined} />)
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Navigation is confusing' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }))
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain(
      'Please try again later.',
    ),
  )
  expect(screen.getByLabelText('Message').getAttribute('maxlength')).toBe(
    '4000',
  )
  expect(screen.getByLabelText('Message')).toHaveValue(
    'Navigation is confusing',
  )
  const payload = JSON.parse(api.mock.calls[0][1].body)
  expect(Object.keys(payload).sort()).toEqual([
    'appVersion',
    'kind',
    'message',
    'path',
    'platform',
  ])
  expect(payload.path).not.toContain('?')
  cleanup()
})
it('can omit all page metadata and acknowledges success', async () => {
  api.mockResolvedValueOnce({ id: 'feedback' })
  render(<FeedbackDialog onClose={() => undefined} />)
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Help' },
  })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }))
  await screen.findByText('Thanks. We read every message.')
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({
    kind: 'problem',
    message: 'Help',
  })
  cleanup()
})
