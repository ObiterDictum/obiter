import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared harness for the shell chrome specs. The sidebar and the top bar are
 * measured through the real rendered layout, so every helper here reads boxes
 * and real input effects rather than class strings. Auth is mocked at the
 * network boundary so no account, database or email is needed.
 */
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
  // The sidebar reads the workspace's counts; empty lists keep the chrome
  // deterministic without inventing data.
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

/** The labelled module list inside the sidebar. */
export function workspaceNav(page: Page) {
  return page.getByRole('navigation', { name: 'Workspace' })
}

export function sidebar(page: Page) {
  return page.locator('#app-sidebar')
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

export async function sidebarToggle(page: Page) {
  return sidebar(page).getByRole('button', {
    name: /(Collapse|Expand) sidebar/,
  })
}

/** Settings is reached through the account menu: its loader runs during SSR,
 * where the mocked session does not apply, so a full page load cannot do it. */
export async function gotoOtherMode(page: Page) {
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()
  await page.getByRole('button', { name: 'Account menu' }).click()
  await page.getByRole('menuitem', { name: 'Account settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
}
