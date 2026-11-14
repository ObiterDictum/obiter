import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'

const { databaseName } = resolveJourneyTargets()
const SHOTS = path.join(homedir(), 'lifecycle-shots')

function sql(statement: string) {
  if (!/_(test|e2e)$/.test(databaseName))
    throw new Error('A disposable database is required')
  return execFileSync(
    'psql',
    ['-d', databaseName, '-v', 'ON_ERROR_STOP=1', '-Atc', statement],
    { encoding: 'utf8' },
  ).trim()
}

async function createOrganisation(page: Page, name: string) {
  return page.evaluate(async (orgName) => {
    const response = await fetch('/api/organisations', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: orgName }),
    })
    if (!response.ok) {
      throw new Error(
        `create organisation failed: ${response.status} ${await response.text()}`,
      )
    }
    const body = (await response.json()) as {
      organisation: { id: string }
    }
    return body.organisation.id
  }, name)
}

function joinOrganisation(
  email: string,
  organisationId: string,
  role: 'admin' | 'member' | 'owner',
) {
  sql(
    `update users set "organisationId" = '${organisationId}', role = '${role}' where email = '${email}'`,
  )
}

async function openSettings(page: Page, section: string) {
  await page.goto(`/settings?section=${section}`, {
    waitUntil: 'networkidle',
  })
}

function settingsRegion(page: Page, name: string) {
  return page.getByRole('region', { name, exact: true })
}

async function signInFresh(page: Page, email: string, password: string) {
  await page.context().clearCookies()
  await signIn(page, email, password)
}

test('an owner changes a member to admin and back and the table shows it', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const owner = await createAccount(request, 'RoleOwner')
  const member = await createAccount(request, 'RoleTarget')
  const orgName = `Role Org ${runId}`

  await signIn(page, owner.email, owner.password)
  const organisationId = await createOrganisation(page, orgName)
  joinOrganisation(member.email, organisationId, 'member')

  await openSettings(page, 'members')
  const members = settingsRegion(page, 'Members')
  await expect(
    members.getByRole('cell', { name: member.email }).first(),
  ).toBeVisible()

  const roleSelect = members.getByRole('combobox', {
    name: 'Role for RoleTarget User',
  })
  await expect(roleSelect).toContainText('Member')
  await roleSelect.click()
  await page.getByRole('option', { name: 'Admin', exact: true }).click()
  await expect(roleSelect).toContainText('Admin')

  await roleSelect.click()
  await page.getByRole('option', { name: 'Member', exact: true }).click()
  await expect(roleSelect).toContainText('Member')
})

test('a plain member sees the member list without invite, role or remove controls', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const owner = await createAccount(request, 'RosterOwner')
  const member = await createAccount(request, 'RosterMember')
  const orgName = `Roster Org ${runId}`

  await signIn(page, owner.email, owner.password)
  const organisationId = await createOrganisation(page, orgName)
  joinOrganisation(member.email, organisationId, 'member')

  await signInFresh(page, member.email, member.password)
  await openSettings(page, 'members')
  const members = settingsRegion(page, 'Members')

  await expect(
    members.getByRole('cell', { name: owner.email }).first(),
  ).toBeVisible()
  await expect(
    members.getByRole('cell', { name: member.email }).first(),
  ).toBeVisible()
  await expect(members.getByRole('combobox')).toHaveCount(0)
  await expect(members.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  await expect(
    members.getByRole('heading', { name: 'Invite a member' }),
  ).toHaveCount(0)
  await expect(
    members.getByRole('cell', { name: 'Owner', exact: true }),
  ).toBeVisible()
  await expect(
    members.getByRole('cell', { name: 'Member', exact: true }),
  ).toBeVisible()
})

test('a member leaves the organisation and their next navigation lands on sign-in', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const owner = await createAccount(request, 'LeaveOwner')
  const member = await createAccount(request, 'LeaveMember')
  const orgName = `Leave Org ${runId}`

  await signIn(page, owner.email, owner.password)
  const organisationId = await createOrganisation(page, orgName)
  joinOrganisation(member.email, organisationId, 'member')

  await signInFresh(page, member.email, member.password)
  await openSettings(page, 'organisation')
  await page
    .getByRole('button', { name: 'Leave organisation', exact: true })
    .click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('You own no matters.')).toBeVisible()
  const confirm = dialog.getByRole('button', {
    name: 'Leave organisation',
    exact: true,
  })
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 })
})

test('an owner transfers ownership by typing the organisation name', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const owner = await createAccount(request, 'TransferOwner')
  const member = await createAccount(request, 'TransferMember')
  const orgName = `Transfer Org ${runId}`

  await signIn(page, owner.email, owner.password)
  const organisationId = await createOrganisation(page, orgName)
  joinOrganisation(member.email, organisationId, 'member')

  await openSettings(page, 'organisation')
  const organisation = settingsRegion(page, 'Organisation')
  await organisation
    .getByRole('button', { name: 'Transfer ownership', exact: true })
    .click()

  const dialog = page.getByRole('dialog')
  await expect(
    dialog.getByRole('heading', { name: 'Transfer ownership' }),
  ).toBeVisible()
  await dialog.getByRole('combobox', { name: 'New owner' }).click()
  await page.getByRole('option', { name: 'TransferMember User' }).click()
  await dialog.getByLabel(`Type ${orgName} to confirm`).fill(orgName)
  await dialog
    .getByRole('button', { name: 'Transfer ownership', exact: true })
    .click()
  await expect(dialog).toBeHidden()

  await expect(
    organisation.getByRole('button', { name: 'Transfer ownership' }),
  ).toHaveCount(0)
  await expect(
    organisation.getByRole('button', { name: 'Leave organisation' }),
  ).toBeVisible()
  await expect(organisation.getByText('Admin', { exact: true })).toBeVisible()
})

test('a change of email to an outside domain is refused with the contact message', async ({
  page,
  request,
}) => {
  const user = await createAccount(request, 'OutsideMail')

  await signIn(page, user.email, user.password)
  await openSettings(page, 'account')
  await page.getByRole('button', { name: 'Change email', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New email').fill('someone@gmail.com')
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog
    .getByRole('button', { name: 'Send confirmation', exact: true })
    .click()

  await expect(dialog.getByRole('alert')).toContainText('Contact Obiter')
})

test('a change to a same-domain address shows the pending confirmation state', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const user = await createAccount(request, 'SameDomain')
  const newEmail = `samedomain-${runId}@obiter.test`

  await signIn(page, user.email, user.password)
  await openSettings(page, 'account')
  await page.getByRole('button', { name: 'Change email', exact: true }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('New email').fill(newEmail)
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog
    .getByRole('button', { name: 'Send confirmation', exact: true })
    .click()

  await expect(dialog).toContainText(`Check ${newEmail} to confirm`)
})

test('an owner of an organisation with other members sees transfer ownership first', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const owner = await createAccount(request, 'SharedOwner')
  const member = await createAccount(request, 'SharedMember')
  const orgName = `Shared Org ${runId}`

  await signIn(page, owner.email, owner.password)
  const organisationId = await createOrganisation(page, orgName)
  joinOrganisation(member.email, organisationId, 'member')

  await openSettings(page, 'account')
  await page
    .getByRole('button', { name: 'Delete account', exact: true })
    .click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Password').fill(owner.password)
  await dialog.getByLabel(`Type ${owner.email} to confirm`).fill(owner.email)
  await dialog
    .getByRole('button', { name: 'Delete account', exact: true })
    .click()

  await expect(dialog.getByRole('alert')).toContainText(
    'Transfer ownership before deleting your account',
  )
})

test('a sole user deletes their account, lands on sign-in and cannot sign in again', async ({
  page,
  request,
}) => {
  const runId = randomUUID().slice(0, 8)
  const user = await createAccount(request, 'SoleUser')
  const orgName = `Sole Org ${runId}`

  await signIn(page, user.email, user.password)
  await createOrganisation(page, orgName)
  await openSettings(page, 'account')
  await page
    .getByRole('button', { name: 'Delete account', exact: true })
    .click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Password').fill(user.password)
  await dialog.getByLabel(`Type ${user.email} to confirm`).fill(user.email)
  await dialog
    .getByRole('button', { name: 'Delete account', exact: true })
    .click()

  await expect(page).toHaveURL(/\/sign-in/, { timeout: 15_000 })

  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(user.email, { delay: 5 })
  await page.getByLabel('Password').click()
  await page
    .getByLabel('Password')
    .pressSequentially(user.password, { delay: 5 })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()

  await expect(page).toHaveURL(/\/sign-in/)
  await expect(page.getByText(/invalid|incorrect|failed/i).first()).toBeVisible(
    { timeout: 15_000 },
  )
})

test.describe('lifecycle screenshots', () => {
  test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })

  test('capture the account and organisation lifecycle settings', async ({
    page,
    request,
  }) => {
    const runId = randomUUID().slice(0, 8)
    const owner = await createAccount(request, 'ShotOwner')
    const member = await createAccount(request, 'ShotMember')
    const orgName = `Harbourside Chambers ${runId}`
    sql(
      `update users set name = 'Avery Owner' where email = '${owner.email}'; update users set name = 'Blake Member' where email = '${member.email}'`,
    )

    await signIn(page, owner.email, owner.password)
    const organisationId = await createOrganisation(page, orgName)
    joinOrganisation(member.email, organisationId, 'member')

    await openSettings(page, 'members')
    await expect(
      settingsRegion(page, 'Members').getByRole('combobox').first(),
    ).toBeVisible()
    await page.screenshot({ path: path.join(SHOTS, '01-members-owner.png') })

    await openSettings(page, 'organisation')
    await page.screenshot({
      path: path.join(SHOTS, '03-organisation-owner.png'),
    })

    const organisation = settingsRegion(page, 'Organisation')
    await organisation
      .getByRole('button', { name: 'Transfer ownership', exact: true })
      .click()
    const transferDialog = page.getByRole('dialog')
    await expect(
      transferDialog.getByRole('combobox', { name: 'New owner' }),
    ).toBeVisible()
    await page.screenshot({
      path: path.join(SHOTS, '05-transfer-ownership-dialog.png'),
    })
    await transferDialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(transferDialog).toBeHidden()

    await openSettings(page, 'account')
    await page.screenshot({
      path: path.join(SHOTS, '07-account.png'),
    })

    const account = settingsRegion(page, 'Account')
    await account
      .getByRole('button', { name: 'Delete account', exact: true })
      .click()
    const deleteDialog = page.getByRole('dialog')
    await expect(
      deleteDialog.getByLabel(`Type ${owner.email} to confirm`),
    ).toBeVisible()
    await page.screenshot({
      path: path.join(SHOTS, '09-delete-account-dialog.png'),
    })
    await deleteDialog.getByLabel('Password').fill(owner.password)
    await deleteDialog
      .getByLabel(`Type ${owner.email} to confirm`)
      .fill(owner.email)
    await deleteDialog
      .getByRole('button', { name: 'Delete account', exact: true })
      .click()
    await expect(deleteDialog.getByRole('alert')).toContainText(
      'Transfer ownership',
    )
    await page.screenshot({
      path: path.join(SHOTS, '10-delete-refusal.png'),
    })
    await deleteDialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .click()
    await expect(deleteDialog).toBeHidden()

    await account
      .getByRole('button', { name: 'Change email', exact: true })
      .click()
    const emailDialog = page.getByRole('dialog')
    await emailDialog.getByLabel('New email').fill(`avery-${runId}@obiter.test`)
    await emailDialog.getByLabel('Current password').fill(owner.password)
    await emailDialog
      .getByRole('button', { name: 'Send confirmation', exact: true })
      .click()
    await expect(emailDialog).toContainText('to confirm')
    await page.screenshot({
      path: path.join(SHOTS, '08-change-email-pending.png'),
    })
    await emailDialog.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(emailDialog).toBeHidden()

    await signInFresh(page, member.email, member.password)
    await openSettings(page, 'members')
    await expect(
      settingsRegion(page, 'Members').getByText('Avery Owner'),
    ).toBeVisible()
    await page.screenshot({
      path: path.join(SHOTS, '02-members-member.png'),
    })

    await openSettings(page, 'organisation')
    await expect(
      settingsRegion(page, 'Organisation').getByRole('button', {
        name: 'Leave organisation',
        exact: true,
      }),
    ).toBeVisible()
    await page.screenshot({
      path: path.join(SHOTS, '04-organisation-member.png'),
    })

    await settingsRegion(page, 'Organisation')
      .getByRole('button', { name: 'Leave organisation', exact: true })
      .click()
    const leaveDialog = page.getByRole('dialog')
    await expect(leaveDialog.getByText('You own no matters.')).toBeVisible()
    await expect(
      leaveDialog.getByRole('button', {
        name: 'Leave organisation',
        exact: true,
      }),
    ).toBeEnabled()
    await page.screenshot({
      path: path.join(SHOTS, '06-leave-organisation-dialog.png'),
    })
  })
})
