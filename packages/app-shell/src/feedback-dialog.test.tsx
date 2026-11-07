import '@obiter/test-dom'
import { expect, it, mock } from 'bun:test'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { vi } from '../../../scripts/test/vitest-compat'
const api = vi.fn()
const original = { ...(await import('./api')) }
mock.module('./api', () => ({ ...original, apiFetch: api }))
const { FeedbackDialog } = await import('./feedback-dialog')
it('keeps the message on failure and sends only allowed metadata', async () => {
  api.mockRejectedValueOnce(new Error('Please try again later.'))
  const view = render(<FeedbackDialog onClose={() => undefined} />)
  fireEvent.change(view.getByLabelText('Message'), {
    target: { value: 'Navigation is confusing' },
  })
  fireEvent.click(view.getByRole('button', { name: 'Send' }))
  await waitFor(() =>
    expect(view.getByRole('alert').textContent).toContain(
      'Please try again later.',
    ),
  )
  expect(view.getByLabelText('Message').getAttribute('maxlength')).toBe('4000')
  expect(view.getByDisplayValue('Navigation is confusing')).toBe(
    view.getByLabelText('Message'),
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
  const view = render(<FeedbackDialog onClose={() => undefined} />)
  fireEvent.change(view.getByLabelText('Message'), {
    target: { value: 'Help' },
  })
  fireEvent.click(view.getByRole('checkbox'))
  fireEvent.click(view.getByRole('button', { name: 'Send' }))
  await view.findByText('Thanks. We read every message.')
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({
    kind: 'problem',
    message: 'Help',
  })
  cleanup()
})
