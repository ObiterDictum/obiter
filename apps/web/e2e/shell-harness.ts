import { expect, type Locator, type Page } from '@playwright/test'

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

export async function mockSession(
  page: Page,
  name = 'Shell Nominal',
  org = 'Obiter',
) {
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
        organisation: { id: 'org_shell_test', name: org, plan: 'private_beta' },
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

export function topBar(page: Page) {
  return page.locator('#app-shell-title-bar')
}

export function topBarTabs(page: Page) {
  return topBar(page).getByRole('group', { name: 'Open in this matter' })
}

export function topBarTab(page: Page, name: string | RegExp) {
  return topBarTabs(page).getByRole('button', { name, exact: true })
}

export function topBarMatterName(page: Page) {
  return topBar(page).getByRole('button', {
    name: /^Switch matter, current matter/,
  })
}

export function breadcrumb(page: Page) {
  return topBar(page).getByRole('navigation', { name: 'Breadcrumb' })
}

export function matterContents(page: Page) {
  return page.getByRole('complementary', { name: 'Matter contents' })
}

export function contentsCrumb(page: Page) {
  return matterContents(page).getByRole('link', { name: 'Matters' })
}

export function matterSwitcherMenu(page: Page) {
  return page.getByRole('menu', { name: 'Switch matter' })
}

export function allMattersItem(page: Page) {
  return matterSwitcherMenu(page).getByRole('menuitem', { name: 'All matters' })
}

export async function gotoOtherMode(page: Page) {
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  await expect(page).toHaveURL(/\/settings\?section=account$/)
}
