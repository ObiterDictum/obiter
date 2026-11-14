import { execFileSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { createAccount } from './document-journey'
import {
  confirmTwoFactorEnrolment,
  signIn,
  startTwoFactorEnrolment,
} from './e13-support'

const { apiOrigin, databaseName } = resolveJourneyTargets()
function sql(statement: string) {
  if (!/_(test|e2e)$/.test(databaseName))
    throw new Error('A disposable database is required')
  return execFileSync(
    'psql',
    ['-d', databaseName, '-v', 'ON_ERROR_STOP=1', '-Atc', statement],
    { encoding: 'utf8' },
  ).trim()
}

test('a forced client error reaches staff without document text and non-staff cannot open errors', async ({
  page,
  request,
  browser,
}) => {
  const staffOrganisation = process.env.OBITER_STAFF_ORGANISATION_ID
  if (!staffOrganisation || !/^[a-zA-Z0-9_-]+$/.test(staffOrganisation))
    throw new Error(
      'Configure a generated staff organisation for this isolated run',
    )
  const staff = await createAccount(request, 'StaffInsight')
  const ordinary = await createAccount(request, 'OrdinaryInsight')
  sql(`insert into organisations (id,name) values ('${staffOrganisation}','Synthetic staff') on conflict do nothing;
    update users set "organisationId" = '${staffOrganisation}', role = 'member' where email = '${staff.email}'`)
  await signIn(page, staff.email, staff.password)
  await page.goto('/staff')
  await expect(
    page.getByText('Staff accounts need two-factor authentication'),
  ).toBeVisible()
  const totpSecret = await startTwoFactorEnrolment(page, staff.password)
  await confirmTwoFactorEnrolment(page, totpSecret)
  await page.goto('/staff')
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('main').getByRole('link', { name: /Access review/ }),
  ).toBeVisible()
  await page.evaluate(async () => {
    const modules = await (await fetch('/src/router.tsx')).text()
    const path = modules.match(
      /from ["']([^"']*error-reporting[^"']*)["']/,
    )?.[1]
    if (!path) throw new Error('Could not resolve the served reporter module')
    const reporter = await import(path)
    reporter.startErrorReporting('web', null, true)
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new Error('SyntheticError "private document text"'),
      }),
    )
    window.dispatchEvent(new Event('pagehide'))
  })
  await page.goto('/staff/errors')
  await expect(
    page.getByRole('heading', { name: 'Errors', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('SyntheticError [quoted]', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('private document text', { exact: true }),
  ).toHaveCount(0)
  const nonstaff = await browser.newContext()
  const nonstaffPage = await nonstaff.newPage()
  await signIn(nonstaffPage, ordinary.email, ordinary.password)
  await expect(
    nonstaffPage.getByRole('link', { name: 'Staff', exact: true }),
  ).toHaveCount(0)
  for (const path of [
    '/staff',
    '/staff/access',
    '/staff/usage',
    '/staff/errors',
  ]) {
    await nonstaffPage.goto(path)
    await expect(
      nonstaffPage.getByText('We cannot find that page'),
    ).toBeVisible()
  }
  for (const path of [
    '/api/staff/overview',
    '/api/staff/usage?weeks=4',
    '/api/staff/errors',
  ]) {
    const response = await nonstaff.request.get(`${apiOrigin}${path}`)
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain(staffOrganisation)
  }
  await nonstaff.close()
})
