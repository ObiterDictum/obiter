import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'

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

test('staff approves an unknown domain and the applicant sets up an account', async ({
  page,
  request,
  browser,
}) => {
  const staffOrganisation = process.env.OBITER_STAFF_ORGANISATION_ID
  if (!staffOrganisation || !/^[a-zA-Z0-9_-]+$/.test(staffOrganisation))
    throw new Error(
      'Configure a generated staff organisation for this isolated run',
    )
  if (process.env.OBITER_E2E_CAPTURE_EMAIL !== '1')
    throw new Error('Enable isolated synthetic email capture for this journey')
  const staff = await createAccount(request, 'StaffReview')
  const ordinary = await createAccount(request, 'OrdinaryReview')
  sql(`insert into organisations (id,name) values ('${staffOrganisation}','Synthetic staff') on conflict do nothing;
    update users set "organisationId" = '${staffOrganisation}', role = 'member' where email = '${staff.email}'`)
  const suffix = crypto.randomUUID()
  const domain = `${suffix}.test`
  const email = `applicant@${domain}`
  const token = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  sql(`insert into access_requests (id,email,email_domain,name,category,country,organisation_name,set_up_organisation,token_hash,token_expires_at)
    values ('ar_${suffix}','${email}','${domain}','Synthetic applicant','legal_professional','scotland','Synthetic Legal',false,'${hash}',now()+interval '24 hours')`)
  await page.goto(`/request-access/confirm?token=${token}`)
  await expect(
    page.getByRole('heading', { name: "We're confirming your organisation" }),
  ).toBeVisible()
  await signIn(page, staff.email, staff.password)
  await page.getByRole('link', { name: 'Staff', exact: true }).click()
  const group = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: domain, exact: true }) })
  await expect(group.getByText(email, { exact: false })).toBeVisible()
  await group.getByRole('button', { name: 'Approve organisation' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm approval' })
    .click()
  await expect(group).toHaveCount(0)
  const messages = await request.get(
    `${apiOrigin}/__e2e/mailbox?email=${encodeURIComponent(email)}`,
  )
  expect(messages.ok()).toBeTruthy()
  const mail: { text: string }[] = await messages.json()
  const setup = mail
    .map(
      (item) =>
        item.text.match(
          /https?:\/\/[^\s]+\/request-access\/setup\?token=[A-Za-z0-9_-]+/,
        )?.[0],
    )
    .find(Boolean)
  if (!setup) throw new Error('Approval setup link was not delivered')
  const applicant = await browser.newContext()
  const signup = await applicant.newPage()
  await signup.goto(setup)
  await signup.getByLabel('Name', { exact: true }).fill('Synthetic applicant')
  await expect(
    signup.getByLabel('Email you confirmed', { exact: true }),
  ).toHaveValue(email)
  await signup
    .getByLabel('Password', { exact: true })
    .fill('Synthetic-applicant-123!')
  await signup
    .getByLabel('Confirm password', { exact: true })
    .fill('Synthetic-applicant-123!')
  await signup
    .getByRole('button', { name: 'Create account', exact: true })
    .click()
  await expect(
    signup.getByRole('heading', { name: 'Check your inbox' }),
  ).toBeVisible()
  expect(sql(`select count(*) from users where email = '${email}'`)).toBe('1')
  await applicant.close()
  const nonstaff = await browser.newContext()
  const nonstaffPage = await nonstaff.newPage()
  await signIn(nonstaffPage, ordinary.email, ordinary.password)
  await expect(
    nonstaffPage.getByRole('link', { name: 'Staff', exact: true }),
  ).toHaveCount(0)
  for (const path of [
    '/api/staff/access',
    '/api/staff/access/decisions',
    '/api/staff/organisations',
  ]) {
    const response = await nonstaff.request.get(`${apiOrigin}${path}`)
    expect(response.status()).toBe(404)
    expect(await response.text()).not.toContain(staffOrganisation)
  }
  await nonstaff.close()
})
