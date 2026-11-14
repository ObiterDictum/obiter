import { execFileSync } from 'node:child_process'
import { test, expect } from '@playwright/test'
import { meResponseSchema } from '@obiter/contracts'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { openMatter } from './support'

const { databaseName, webOrigin } = resolveJourneyTargets()

test('private research remembers turns and denies colleagues access', async ({
  page,
  request,
  browser,
}) => {
  const owner = await createAccount(request, 'AgentOwner')
  const colleague = await createAccount(request, 'AgentColleague')
  await signIn(page, owner.email, owner.password)
  const created = await page.request.post('/api/organisations', {
    data: { name: 'Agent Synthetic Chambers' },
    headers: { Origin: webOrigin },
  })
  expect(created.ok(), await created.text()).toBe(true)
  await page.reload()
  const me = meResponseSchema.parse(
    await (await page.request.get('/api/me')).json(),
  )
  if (!me.organisation) throw new Error('An organisation is required')
  if (!/_(test|e2e)$/.test(databaseName))
    throw new Error('A disposable database is required')
  execFileSync('psql', [
    '-d',
    databaseName,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `update users set "organisationId" = '${me.organisation.id}', role = 'member' where email = '${colleague.email}'`,
  ])
  await page.getByRole('link', { name: 'Agent', exact: true }).click()
  await expect(page).toHaveURL(/\/agent$/)
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('What are the elements of negligence?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page).toHaveURL(/\/agent\/[^/]+$/)
  const url = page.url()
  await expect(
    page
      .getByRole('list', { name: 'Sources' })
      .first()
      .getByRole('link')
      .first(),
  ).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeEnabled({
    timeout: 60000,
  })
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('How does that apply to a duty of care?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('list', { name: 'Sources' })).toHaveCount(2, {
    timeout: 60000,
  })
  await expect(
    page
      .getByRole('navigation', { name: 'Conversations' })
      .getByRole('link', { name: /What are the elements/ }),
  ).toHaveAttribute('aria-current', 'page')
  const other = await browser.newContext()
  const otherPage = await other.newPage()
  await signIn(otherPage, colleague.email, colleague.password)
  await otherPage.goto('/agent')
  await expect(
    otherPage.getByRole('textbox', { name: 'Message' }),
  ).toBeVisible()
  await otherPage.goto(url)
  await expect(
    otherPage.getByRole('heading', { name: /cannot find that page/i }),
  ).toBeVisible()
  await other.close()
  await openMatter(page, 'Agent panel matter')
  await page.getByRole('button', { name: 'Show agent panel' }).click()
  await expect(
    page.getByRole('button', { name: 'Hide agent panel' }),
  ).toHaveAttribute('aria-expanded', 'true')
})
