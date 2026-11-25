import { expect, type Locator, type Page } from '@playwright/test'
import { createAccount } from './document-journey'
import { resolveJourneyTargets } from '../journey-target.mjs'

export const WIDTHS = [320, 390, 768, 1024, 1440]
export const MODULES = [
  { name: 'Home', path: '/' },
  { name: 'Search', path: '/search' },
  { name: 'Matters', path: '/matters' },
  { name: 'Verify', path: '/verify' },
  { name: 'Redact', path: '/redact' },
] as const

export const LONG_NAME = 'Alexandra-Cassandra Montgomery-Fitzwilliam III'
export const LONG_ORG = 'Montgomery, Fitzwilliam and Partners International LLP'

export async function signInShellAccount(
  page: Page,
  name: string,
  organisation?: string,
) {
  const { webOrigin } = resolveJourneyTargets()
  const account = await createAccount(page.request, 'Shell', name)
  const signIn = await page.request.post(
    `${webOrigin}/api/auth/sign-in/email`,
    {
      data: account,
      headers: { Origin: webOrigin },
    },
  )
  expect(signIn.ok()).toBe(true)
  if (organisation) {
    const response = await page.request.post(`${webOrigin}/api/organisations`, {
      data: { name: organisation },
      headers: { Origin: webOrigin },
    })
    expect(response.ok(), await response.text()).toBe(true)
  }
}

export async function mockSession(page: Page) {
  const name = 'Shell Nominal'
  await signInShellAccount(page, name)
  await page.route('**/api/auth/get-session', (route) =>
    route.fulfill({
      json: {
        session: { id: 'sess_shell_test', userId: 'usr_shell_test' },
        user: {
          id: 'usr_shell_test',
          name,
          email: 'shell-test@obiter.test',
          emailVerified: true,
        },
      },
    }),
  )
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'usr_shell_test',
          name,
          email: 'shell-test@obiter.test',
          role: 'owner',
        },
        organisation: {
          id: 'org_shell_test',
          name: 'Obiter',
          plan: 'private_beta',
        },
      },
    }),
  )
  await page.route('**/api/matters', (route) =>
    route.fulfill({ json: { matters: [] } }),
  )
  await page.route('**/api/redaction-runs', (route) =>
    route.fulfill({ json: { runs: [] } }),
  )
  await page.route('**/api/verification-runs**', (route) =>
    route.fulfill({ json: { runs: [], nextCursor: null } }),
  )
}

export function workspaceNav(page: Page) {
  return page.getByRole('navigation', { name: 'Workspace' })
}

export async function gotoMatters(page: Page) {
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()
  await workspaceNav(page)
    .getByRole('link', { name: /^Matters/ })
    .click()
  await expect(page).toHaveURL(/\/matters$/)
}

export function sidebar(page: Page) {
  return page.locator('#app-shell-sidebar')
}

export function documentWidths(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

export async function asideWidth(aside: Locator) {
  return aside.evaluate((element) => element.getBoundingClientRect().width)
}

export function sidebarToggle(page: Page) {
  return page.getByRole('button', {
    name: /(Collapse|Expand) sidebar/,
  })
}

export async function gotoOtherMode(page: Page) {
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  await expect(page).toHaveURL(/\/settings\?section=account$/)
}
