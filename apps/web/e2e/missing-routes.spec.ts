import { expect, test } from '@playwright/test'
import type { AnyRouter } from '@tanstack/react-router'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { openMatter } from './support'

test('missing workspace records and legal sources return HTTP 404 and render a not-found state', async ({
  page,
}) => {
  const { email, password } = await createAccount(page.request, 'MissingRoutes')
  await signIn(page, email, password)
  await openMatter(page, 'Missing route fixture')
  const matter = new URL(page.url()).pathname

  const missing = [
    ['/matters/mat_doesnotexist', 'This matter does not exist'],
    [`${matter}/documents/doc_doesnotexist`, 'This document does not exist'],
    ['/redact/red_doesnotexist', 'This redaction run does not exist'],
    [`${matter}/redact/red_doesnotexist`, 'This redaction run does not exist'],
    ['/case/doesnotexist', 'This document does not exist'],
    ['/cases/doesnotexist', 'This document does not exist'],
    ['/ln/ukpga/2099/999', 'This document does not exist'],
    ['/ln/ukpga/2099/999/section/999', 'This document does not exist'],
  ] as const

  for (const [path, title] of missing) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
    await expect(page.getByRole('heading', { name: title }), path).toBeVisible()
  }

  await page.goto(matter)
  await page.waitForFunction(() => '__TSR_ROUTER__' in window)
  let redactionRequests = 0
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/api/redaction-runs/red_doesnotexist'
    )
      redactionRequests += 1
  })
  for (const [path, title] of missing) {
    await page.evaluate(async (to) => {
      const router = (window as Window & { __TSR_ROUTER__?: AnyRouter })
        .__TSR_ROUTER__
      if (!router) throw new Error('The app router is missing.')
      await router.navigate({ to })
    }, path)
    await expect(page).toHaveURL(path)
    await expect(page.getByRole('heading', { name: title }), path).toBeVisible()
  }
  expect(redactionRequests).toBe(2)
})
