import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Toaster, ToastProvider, useToast } from '../toast'

function Probe({ timeout }: { timeout?: number }) {
  const { toast } = useToast()
  return (
    <button
      type="button"
      onClick={() => toast({ title: 'Saved', tone: 'success', timeout })}
    >
      fire
    </button>
  )
}

function NoProviderConsumer() {
  useToast()
  return null
}

describe('Toast', () => {
  it('renders and dismisses a toast on demand', () => {
    render(
      <ToastProvider>
        <Probe />
        <Toaster />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Saved')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Dismiss notification'))
    expect(screen.queryByText('Saved')).toBeNull()
  })

  it('auto-dismisses after the timeout', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Probe timeout={1000} />
        <Toaster />
      </ToastProvider>,
    )

    fireEvent.click(screen.getByText('fire'))
    expect(screen.getByText('Saved')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1001)
    })
    expect(screen.queryByText('Saved')).toBeNull()
    vi.useRealTimers()
  })

  it('throws when useToast is used outside the provider', () => {
    // Suppress the expected console.error from React's error boundary logging.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<NoProviderConsumer />)).toThrow(
      /useToast must be used within/,
    )
    spy.mockRestore()
  })
})
