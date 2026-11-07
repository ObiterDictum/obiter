import { expect, it, mock } from 'bun:test'
const init = mock(() => {})
mock.module('@sentry/react', () => ({
  init,
  globalHandlersIntegration: () => ({ name: 'GlobalHandlers' }),
}))
const { startErrorReporting } = await import('./error-reporting')
it('does not initialize the SDK without a DSN', async () => {
  await startErrorReporting(undefined, 'commit', false)
  expect(init).not.toHaveBeenCalled()
})
it('initializes reporting only after explicitly starting with a DSN', async () => {
  await startErrorReporting('https://key@example.com/1', 'commit', false)
  expect(init).toHaveBeenCalledTimes(1)
})
