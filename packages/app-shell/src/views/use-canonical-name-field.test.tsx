import '@obiter/test-dom'
import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useCanonicalNameField } from './use-canonical-name-field'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Harness({
  identity,
  canonical,
  save,
}: {
  identity: string
  canonical: string
  save: (name: string) => Promise<string>
}) {
  const field = useCanonicalNameField({
    identity,
    canonical,
    requiredMessage: 'Name is required.',
    failureMessage: 'Could not save.',
    save,
    focusField: () => undefined,
  })
  return (
    <div>
      <input
        aria-label="name"
        value={field.value}
        onChange={(event) => field.setValue(event.target.value)}
      />
      <button type="button" onClick={() => field.submit()}>
        save
      </button>
      <button type="button" onClick={field.reset}>
        reset
      </button>
      <span data-testid="error">{field.error ?? ''}</span>
      <span data-testid="saved">{String(field.saved)}</span>
    </div>
  )
}

function nameInput() {
  return screen.getByLabelText<HTMLInputElement>('name')
}

function click(label: 'save' | 'reset') {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useCanonicalNameField', () => {
  it('does not let a stale response regress a later canonical value', async () => {
    const pending = deferred<string>()
    const save = vi.fn(() => pending.promise)
    const view = render(
      <Harness identity="usr_1" canonical="Old Name" save={save} />,
    )

    fireEvent.change(nameInput(), { target: { value: 'Submitted Name' } })
    click('save')

    view.rerender(
      <Harness identity="usr_1" canonical="Renamed Elsewhere" save={save} />,
    )

    await act(async () => {
      pending.resolve('Submitted Name')
    })

    expect(nameInput().value).toBe('Renamed Elsewhere')

    fireEvent.change(nameInput(), { target: { value: 'A newer draft' } })
    click('reset')
    expect(nameInput().value).toBe('Renamed Elsewhere')
  })

  it('keeps newer typing when the save resolves', async () => {
    const pending = deferred<string>()
    const save = vi.fn(() => pending.promise)
    render(<Harness identity="usr_1" canonical="Old Name" save={save} />)

    fireEvent.change(nameInput(), { target: { value: 'Submitted Name' } })
    click('save')
    fireEvent.change(nameInput(), { target: { value: 'Typed During Flight' } })

    await act(async () => {
      pending.resolve('Submitted Name')
    })

    expect(nameInput().value).toBe('Typed During Flight')
    click('reset')
    expect(nameInput().value).toBe('Submitted Name')
  })

  it('preserves the draft and the previous baseline when the save fails', async () => {
    const pending = deferred<string>()
    const save = vi.fn(() => pending.promise)
    render(<Harness identity="usr_1" canonical="Old Name" save={save} />)

    fireEvent.change(nameInput(), { target: { value: 'Attempted Name' } })
    click('save')

    await act(async () => {
      pending.reject(new Error('network down'))
    })

    expect(nameInput().value).toBe('Attempted Name')
    expect(screen.getByTestId('error').textContent).toBe('Could not save.')
    click('reset')
    expect(nameInput().value).toBe('Old Name')
  })

  it('discards the draft and any in-flight response on an identity switch', async () => {
    const pending = deferred<string>()
    const save = vi.fn(() => pending.promise)
    const view = render(
      <Harness identity="usr_1" canonical="Old Name" save={save} />,
    )

    fireEvent.change(nameInput(), { target: { value: 'Draft For Old User' } })
    click('save')

    view.rerender(
      <Harness identity="usr_9" canonical="Other User Name" save={save} />,
    )
    expect(nameInput().value).toBe('Other User Name')

    await act(async () => {
      pending.resolve('Draft For Old User')
    })
    expect(nameInput().value).toBe('Other User Name')
    expect(screen.getByTestId('saved').textContent).toBe('false')
  })

  it('adopts an external value into a clean field and resets to it', () => {
    const save = vi.fn(async (name: string) => name)
    const view = render(
      <Harness identity="usr_1" canonical="Old Name" save={save} />,
    )

    view.rerender(
      <Harness identity="usr_1" canonical="Renamed Elsewhere" save={save} />,
    )
    expect(nameInput().value).toBe('Renamed Elsewhere')

    fireEvent.change(nameInput(), { target: { value: 'dirty' } })
    click('reset')
    expect(nameInput().value).toBe('Renamed Elsewhere')
  })
})
