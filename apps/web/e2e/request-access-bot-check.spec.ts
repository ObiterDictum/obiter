import { expect, test, type Page } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'

const { webOrigin } = resolveJourneyTargets()
const PRODUCTION_ORIGIN = 'http://app.obiter.si'
const FAILURE = "We couldn't confirm you're not a bot. Try again."

const FAKE_TURNSTILE = `
window.__turnstileWidgets = []
window.turnstile = {
  render(element, options) {
    window.__turnstileWidgets.push(options)
    return 'widget-' + window.__turnstileWidgets.length
  },
  reset() {},
  remove() {},
}
`

async function servePageAsProduction(page: Page) {
  await page.routeWebSocket(/.*/, () => {})
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: FAKE_TURNSTILE }),
  )
  await page.route(`${PRODUCTION_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: `${webOrigin}${url.pathname}${url.search}`,
    })
    await route.fulfill({ response })
  })
}

test('a bot check that never answers shows an error with a working retry', async ({
  page,
}) => {
  await servePageAsProduction(page)
  await page.clock.install()
  await page.goto(`${PRODUCTION_ORIGIN}/request-access`)

  await page.getByRole('textbox', { name: 'Name' }).fill('Synthetic Applicant')
  const waiting = page.getByRole('button', { name: 'Checking your browser…' })
  await expect(waiting).toBeDisabled()
  await expect
    .poll(() => page.evaluate(() => window.__turnstileWidgets?.length ?? 0))
    .toBe(1)

  await page.clock.fastForward(20_000)
  await expect(
    page.getByRole('alert').filter({ hasText: FAILURE }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue(
    'Synthetic Applicant',
  )

  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByText(FAILURE)).toHaveCount(0)
  await expect(waiting).toBeDisabled()
  await expect
    .poll(() => page.evaluate(() => window.__turnstileWidgets?.length ?? 0))
    .toBe(2)

  await page.evaluate(() => window.__turnstileWidgets?.[1]?.callback?.('token'))
  await expect(
    page.getByRole('button', { name: 'Request access', exact: true }),
  ).toBeEnabled()
})

test('a Turnstile error shows the same retry', async ({ page }) => {
  await servePageAsProduction(page)
  await page.goto(`${PRODUCTION_ORIGIN}/request-access`)
  await expect
    .poll(() => page.evaluate(() => window.__turnstileWidgets?.length ?? 0))
    .toBe(1)

  await page.evaluate(() =>
    window.__turnstileWidgets?.[0]?.['error-callback']?.(),
  )
  await expect(
    page.getByRole('alert').filter({ hasText: FAILURE }),
  ).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Jurisdiction' }),
  ).toBeVisible()
})

declare global {
  interface Window {
    __turnstileWidgets?: {
      callback?: (token: string) => void
      'error-callback'?: () => void
    }[]
  }
}
