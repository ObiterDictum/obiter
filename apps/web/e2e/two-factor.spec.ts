import { expect, test, type Page } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn, signOut, startTwoFactorEnrolment } from './e13-support'
import { generateTotpCode } from './totp'

async function submitCredentials(page: Page, email: string, password: string) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function expectTwoFactorStep(page: Page) {
  await expect(
    page.getByRole('heading', { name: 'Two-factor authentication' }),
  ).toBeVisible({ timeout: 15_000 })
}

async function wrongCode(correct: string) {
  const flipped =
    correct.slice(0, 5) + String((Number(correct.slice(5)) + 1) % 10)
  return flipped === correct ? correct.slice(0, 5) + '0' : flipped
}

test('a user enrols in two-factor, signs in with a code or backup code, and turns it off', async ({
  page,
  request,
}) => {
  const account = await createAccount(request, 'TwoFactor')

  await signIn(page, account.email, account.password)
  await page.goto('/settings?section=security')
  await expect(
    page.getByText('Two-factor authentication is off', { exact: false }),
  ).toBeVisible()

  const totpSecret = await startTwoFactorEnrolment(page, account.password)
  const goodCode = await generateTotpCode(totpSecret)
  await page.getByLabel('Authentication code').fill(await wrongCode(goodCode))
  await page
    .getByRole('button', { name: 'Confirm and turn on', exact: true })
    .click()
  await expect(
    page.getByText('That code is not correct', { exact: false }),
  ).toBeVisible()

  const enrolCode = await generateTotpCode(totpSecret)
  await page.getByLabel('Authentication code').fill(enrolCode)
  await page
    .getByRole('button', { name: 'Confirm and turn on', exact: true })
    .click()
  await expect(
    page.getByText('Each one works once', { exact: false }),
  ).toBeVisible({ timeout: 15_000 })
  const backupCodes = page.locator(
    'section[aria-label="Two-factor authentication"] ul li',
  )
  await expect(backupCodes).toHaveCount(10)
  const firstBackupCode = (await backupCodes.first().innerText()).trim()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(
    page.getByText('Two-factor authentication is on', { exact: false }),
  ).toBeVisible()

  await signOut(page)
  await submitCredentials(page, account.email, account.password)
  await expectTwoFactorStep(page)
  await expect(page.getByLabel('Authentication code')).toBeVisible()

  const badSignIn = await generateTotpCode(totpSecret)
  await page.getByLabel('Authentication code').fill(await wrongCode(badSignIn))
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await expect(
    page.getByText('That code is not correct', { exact: false }),
  ).toBeVisible()
  await page
    .getByLabel('Authentication code')
    .fill(await generateTotpCode(totpSecret))
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })

  await signOut(page)
  await submitCredentials(page, account.email, account.password)
  await expectTwoFactorStep(page)
  await page.getByRole('switch', { name: 'Use a backup code' }).click()
  await expect(page.getByRole('textbox', { name: 'Backup code' })).toBeVisible()
  await page.getByRole('textbox', { name: 'Backup code' }).fill(firstBackupCode)
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })

  await signOut(page)
  await submitCredentials(page, account.email, account.password)
  await expectTwoFactorStep(page)
  await page.getByRole('switch', { name: 'Use a backup code' }).click()
  await page.getByRole('textbox', { name: 'Backup code' }).fill(firstBackupCode)
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await expect(
    page.getByText(
      /That code is not correct|Could not verify your second factor/,
    ),
  ).toBeVisible()
  await page.getByRole('switch', { name: 'Use a backup code' }).click()
  await page
    .getByLabel('Authentication code')
    .fill(await generateTotpCode(totpSecret))
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })

  await page.goto('/settings?section=security')
  await page.getByRole('button', { name: 'Turn off', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Confirm your password' })
    .fill(account.password)
  await page
    .getByRole('button', { name: 'Turn off two-factor', exact: true })
    .click()
  await expect(
    page.getByText('Two-factor authentication is off', { exact: false }),
  ).toBeVisible()

  await signOut(page)
  await submitCredentials(page, account.email, account.password)
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await expect(
    page.getByRole('heading', { name: 'Two-factor authentication' }),
  ).toHaveCount(0)
})
