import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { ErrorReportingBoundary } from './error-boundary'
import { startErrorReporting } from './error-reporting'
afterEach(cleanup)
it('reports a render error and presents the shell recovery message', () => {
  let sent = false
  const original = navigator.sendBeacon
  navigator.sendBeacon = () => {
    sent = true
    return true
  }
  const stop = startErrorReporting('web', null, true)
  function Broken(): never {
    throw new Error('Synthetic render error')
  }
  const view = render(
    <ErrorReportingBoundary>
      <Broken />
    </ErrorReportingBoundary>,
  )
  expect(view.getByRole('alert').textContent).toContain('Reload Obiter')
  window.dispatchEvent(new Event('pagehide'))
  expect(sent).toBe(true)
  stop()
  navigator.sendBeacon = original
})
