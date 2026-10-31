import '@obiter/test-dom'
import { expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import { useLatestHandlers } from './use-latest-callback'

function Probe({ value }: { value: { nested: { onRun: () => void } } }) {
  const stable = useLatestHandlers(value)
  return <button onClick={() => stable.nested.onRun()}>run</button>
}

it('invokes the latest nested handler', () => {
  const first = mock()
  const second = mock()
  const view = render(<Probe value={{ nested: { onRun: first } }} />)
  view.rerender(<Probe value={{ nested: { onRun: second } }} />)
  fireEvent.click(screen.getByText('run'))
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
})
