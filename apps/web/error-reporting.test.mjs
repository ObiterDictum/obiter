import { expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
it('defers the SDK import until after paint and a runtime DSN is present', async () => {
  const source = await readFile(
    new URL('./src/error-reporting.ts', import.meta.url),
    'utf8',
  )
  expect(source.indexOf('requestAnimationFrame')).toBeLessThan(
    source.indexOf('setTimeout'),
  )
  expect(source.indexOf('if (!config.dsn) return')).toBeLessThan(
    source.indexOf('await import('),
  )
  expect(source).not.toMatch(/^import .*sentry/m)
})
