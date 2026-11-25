import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { signIn } from './e13-support'
import { verifyEmailInDb } from './support'

const { databaseName } = resolveJourneyTargets()
const password = 'Synthetic-account-123!'
const organisationName = 'Example Legal'

function sql(statement: string) {
  if (!databaseName.endsWith('_e2e'))
    throw new Error('A disposable e2e database is required')
  return execFileSync(
    'psql',
    ['-d', databaseName, '-v', 'ON_ERROR_STOP=1', '-Atc', statement],
    { encoding: 'utf8' },
  ).trim()
}

function hash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

async function fillAccount(page: Page) {
  await page.getByLabel('Name', { exact: true }).fill('Synthetic applicant')
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByLabel('Confirm password', { exact: true }).fill(password)
}

for (const individual of [false, true]) {
  test(
    individual ? 'continues as an individual' : 'creates a named organisation',
    async ({ page }, testInfo) => {
      const id = randomUUID()
      const email = `applicant-${id}@example.com`
      const token = randomUUID()
      sql(`insert into access_requests
      (id,email,email_domain,name,category,country,organisation_name,set_up_organisation,token_hash,token_expires_at,status,confirmed_at,decided_at,verified_at,verification_method,verifier,expires_at,setup_token_hash,setup_token_expires_at)
      values ('ar_${id}','${email}','example.com','Synthetic applicant','legal_professional','scotland','Example Legal',false,'${hash(id)}',now()+interval '1 day','verified',now(),now(),now(),'manual_review','system',now()+interval '1 day','${hash(token)}',now()+interval '1 day')`)
      await page.setViewportSize(
        individual ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      )
      await page.goto(`/request-access/setup?token=${token}`)
      await fillAccount(page)
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(
        page.getByRole('heading', { name: 'Create an organisation' }),
      ).toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('organisation-choice.png'),
      })
      const expectedName = individual ? 'Personal workspace' : organisationName
      if (individual) {
        await page
          .getByRole('button', { name: 'Continue as an individual' })
          .click()
      } else {
        await page.getByRole('button', { name: 'Create organisation' }).click()
        await expect(page.getByRole('alert')).toHaveText(
          'Organisation name is required.',
        )
        await page.getByLabel('Organisation name').fill(organisationName)
        await page.getByRole('button', { name: 'Create organisation' }).click()
      }
      await expect(
        page.getByRole('heading', { name: 'Check your inbox' }),
      ).toBeVisible()
      expect((await page.request.get('/api/me')).status()).toBe(401)
      verifyEmailInDb(databaseName, email)
      await signIn(page, email, password)
      expect((await page.request.get('/api/matters')).ok()).toBeTruthy()
      await expect
        .poll(() =>
          sql(
            `select o.name || ':' || u.role from users u join organisations o on o.id = u."organisationId" where u.email = '${email}'`,
          ),
        )
        .toBe(`${expectedName}:owner`)
    },
  )
}

test('invited registration joins the inviting organisation directly', async ({
  page,
}, testInfo) => {
  const id = randomUUID()
  const email = `invitee-${id}@example.com`
  const token = randomUUID()
  const organisationId = `org_${id}`
  sql(`insert into organisations (id,name) values ('${organisationId}','${organisationName}');
    insert into users (id,name,email,"emailVerified","organisationId",role)
      values ('usr_${id}','Synthetic inviter','inviter-${id}@example.com',true,'${organisationId}','owner');
    insert into verified_organisation_domains (domain,organisation_id,verified_by) values ('example.com','${organisationId}','system');
    insert into organisation_invites (id,organisation_id,email,role,token_hash,expires_at,created_by)
      values ('inv_${id}','${organisationId}','${email}','member','${hash(token)}',now()+interval '1 day','usr_${id}')`)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/invites/accept?token=${token}`)
  await fillAccount(page)
  await expect(page.getByLabel('Organisation name')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('invited-account.png') })
  await page.getByRole('button', { name: 'Create account and join' }).click()
  await expect(page).toHaveURL('/')
  expect(await (await page.request.get('/api/me')).json()).toMatchObject({
    organisation: { id: organisationId },
    user: { email, role: 'member' },
  })
})
