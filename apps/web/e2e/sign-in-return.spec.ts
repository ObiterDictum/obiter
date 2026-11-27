import { expect, test, type Page } from '@playwright/test'
import { createAccount } from './document-journey'
import {
  confirmTwoFactorEnrolment,
  openMatterDocument,
  signIn,
  signOut,
  startTwoFactorEnrolment,
} from './e13-support'
import { generateTotpCode } from './totp'
import { resolveJourneyTargets } from '../journey-target.mjs'

const { webOrigin } = resolveJourneyTargets()

async function submitPassword(page: Page, email: string, password: string) {
  await page.waitForLoadState('networkidle')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

function unauthorisedRequests(page: Page): string[] {
  const failures: string[] = []
  page.on('response', (response) => {
    if (response.status() === 401)
      failures.push(new URL(response.url()).pathname)
  })
  return failures
}

test('signed-out search, judgment and legislation links redirect to sign-in', async ({
  page,
}) => {
  for (const path of [
    '/search?q=Potanina',
    '/case/potanina-v-potanin-2024-uksc-3',
    '/cases/uksc-2024-3',
    '/ln/ukpga/2010/15',
  ]) {
    const response = await page.request.get(path, { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    const destination = new URL(response.headers().location, webOrigin)
    expect(destination.pathname).toBe('/sign-in')
    expect(destination.searchParams.get('redirect')).toBe(path)
  }
})

test('a signed-out judgment link returns to and focuses its paragraph after sign-in', async ({
  page,
  request,
}) => {
  const account = await createAccount(request, 'JudgmentAnchor')
  const judgmentPath = '/case/potanina-v-potanin-2024-uksc-3'
  await page.route('**/api/search/documents/uksc-2024-3', (route) =>
    route.fulfill({
      json: {
        document: {
          id: 'uksc-2024-3',
          title: 'Potanina v Potanin',
          neutralCitation: '[2024] UKSC 3',
          court: 'uksc',
          dateDecided: '2024-01-31',
          sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
          paragraphs: [
            { id: 'p12', paragraphNumber: 12, text: 'A fixture paragraph.' },
          ],
        },
        courtParagraphNumbers: true,
      },
    }),
  )

  await page.goto(`${judgmentPath}#para-12`)
  await expect(page).toHaveURL((url) => url.pathname === '/sign-in')
  await submitPassword(page, account.email, account.password)

  await expect(page).toHaveURL(
    (url) => url.pathname === judgmentPath && url.hash === '#para-12',
  )
  await expect(page.locator('#para-12')).toBeFocused()
})

test('a signed-out Act link returns to and focuses its section after sign-in', async ({
  page,
  request,
}) => {
  const account = await createAccount(request, 'ActAnchor')
  const identity = 'ukpga/2010/15'
  const actPath = `/ln/${identity}`
  const officialUrl = `https://www.legislation.gov.uk/${identity}`
  const labelPath = 'section/12'
  const section = {
    kind: 'P1',
    label: 's. 12',
    heading: 'Fixture section',
    labelPath,
    href: `${actPath}/${labelPath}`,
    extent: 'E+W',
    withheld: false,
    children: [],
  }
  await page.route(`**/api/search/legislation/${identity}`, (route) =>
    route.fulfill({
      json: {
        act: {
          identity,
          title: 'Fixture Act',
          year: 2010,
          number: 15,
          chapter: '2010 c. 15',
          extent: 'E+W',
          canonicalUrl: actPath,
          officialUrl,
          sourceUrl: officialUrl,
          totalCount: 1,
          withheldCount: 0,
          repealedCount: 0,
          contents: [section],
        },
      },
    }),
  )
  await page.route(`**/api/search/legislation/${identity}/text?*`, (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            labelPath,
            provision: {
              officialUrl: `${officialUrl}/${labelPath}`,
              canonicalUrl: section.href,
              legislationStatus: 'current',
              text: 'Fixture wording.',
            },
          },
        ],
        nextOffset: null,
      },
    }),
  )

  await page.goto(`${actPath}#section-12`)
  await expect(page).toHaveURL((url) => url.pathname === '/sign-in')
  await submitPassword(page, account.email, account.password)

  await expect(page).toHaveURL(
    (url) => url.pathname === actPath && url.hash === '#section-12',
  )
  await expect(
    page.getByRole('heading', { name: 's. 12 · Fixture section' }),
  ).toBeFocused()
})

test('a document link opens the document, and survives sign-in', async ({
  page,
  request,
}) => {
  const account = await createAccount(request, 'DeepLink')
  await signIn(page, account.email, account.password)
  await openMatterDocument(page, 'Deep link matter')
  const documentPath = new URL(page.url()).pathname
  const documentTab = page
    .getByRole('group', { name: 'Open in this matter' })
    .getByRole('button', { name: 'e4-lists-styles.docx', exact: true })

  await page.goto('/')
  await page.goto(documentPath)
  await expect(page).toHaveURL(new RegExp(`${documentPath}$`))
  await expect(documentTab).toBeVisible({ timeout: 30_000 })

  const failures = unauthorisedRequests(page)
  await signOut(page)
  await page.goto(documentPath)
  await page.waitForURL('**/sign-in?**')
  expect(new URL(page.url()).searchParams.get('redirect')).toBe(documentPath)
  await page.waitForLoadState('networkidle')
  expect(
    failures.filter(
      (path) => path !== '/api/me' && !path.startsWith('/api/auth/'),
    ),
  ).toEqual([])

  await submitPassword(page, account.email, account.password)
  await page.waitForURL((url) => url.pathname === documentPath, {
    timeout: 15_000,
  })
  await expect(documentTab).toBeVisible({ timeout: 30_000 })
})

test('the requested page survives a two-factor sign-in', async ({
  page,
  request,
}) => {
  const account = await createAccount(request, 'DeepLinkTwoFactor')
  await signIn(page, account.email, account.password)
  const totpSecret = await startTwoFactorEnrolment(page, account.password)
  await confirmTwoFactorEnrolment(page, totpSecret)
  await signOut(page)

  await page.goto('/settings?section=security')
  await page.waitForURL('**/sign-in?**')
  await submitPassword(page, account.email, account.password)
  await page
    .getByLabel('Authentication code')
    .fill(await generateTotpCode(totpSecret))
  await page
    .getByRole('button', { name: 'Verify and sign in', exact: true })
    .click()

  await page.waitForURL(
    (url) =>
      url.pathname === '/settings' &&
      url.searchParams.get('section') === 'security',
    { timeout: 15_000 },
  )
})

test('an off-site return target is ignored', async ({ page, request }) => {
  const account = await createAccount(request, 'DeepLinkOffsite')
  await page.goto('/sign-in?redirect=%2F%2Fevil.example%2Fmatters')
  await submitPassword(page, account.email, account.password)

  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  expect(new URL(page.url()).origin).toBe(new URL(webOrigin).origin)
  expect(new URL(page.url()).pathname).toBe('/')
})

test('sign-in errors stay on their own tab', async ({ page, request }) => {
  const account = await createAccount(request, 'SignInTabs')
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await submitPassword(page, account.email, 'not-the-password')
  await expect(page.getByText('Invalid email or password')).toHaveCount(1)

  await page.getByRole('button', { name: 'Email link', exact: true }).click()
  await expect(page.getByText('Invalid email or password')).toHaveCount(0)
})
