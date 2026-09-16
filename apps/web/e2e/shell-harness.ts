import { expect, type Locator, type Page } from '@playwright/test'

/**
 * Shared harness for the shell chrome specs. The mode bar and the left rail are
 * measured through the real rendered layout, so every helper here reads boxes,
 * scroll offsets and real input effects rather than class strings, and auth is
 * mocked at the network boundary so no account, database or email is needed.
 */
export const WIDTHS = [320, 390, 768, 1024, 1440]
export const SCROLLING_WIDTHS = [640, 768, 1024, 1279]
export const MODES = [
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
}

export function modeNav(page: Page) {
  return page.getByRole('navigation', { name: 'Modes' })
}

/** The horizontally scrollable box the mode nav lives in. */
export function modeRail(page: Page) {
  return page.locator('nav[aria-label="Modes"]').locator('..')
}

export function documentWidths(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
}

/** The rail's width transition means a reveal must settle before measuring. */
export async function asideWidth(aside: Locator) {
  return aside.evaluate((element) => element.getBoundingClientRect().width)
}

/**
 * Park the pointer clear of the left rail so hover expansion is not in play, and
 * wait for any expansion it caused to finish retracting. Without this a
 * measurement or a wheel can land on another control while the rail is still
 * animating underneath the pointer.
 */
export async function parkPointer(page: Page, width: number) {
  await page.mouse.move(width - 20, 700)
  await page.waitForTimeout(300)
}

export async function scrollLeft(page: Page) {
  return modeRail(page).evaluate((element) => element.scrollLeft)
}

export async function resetRailScroll(page: Page) {
  await modeRail(page).evaluate((element) => {
    element.scrollLeft = 0
  })
}

/**
 * Record `defaultPrevented` for real wheel events. The listener runs after the
 * rail's own non-passive handler, so a consumed wheel is visible as `true` and a
 * wheel the rail left to the browser as `false`.
 */
export async function observeWheel(page: Page) {
  await page.evaluate(() => {
    const flags: boolean[] = []
    Object.defineProperty(window, '__wheelDefaultsPrevented', {
      value: flags,
      configurable: true,
    })
    window.addEventListener(
      'wheel',
      (event) => {
        flags.push(event.defaultPrevented)
      },
      { passive: true },
    )
  })
}

export async function clearWheelLog(page: Page) {
  await page.evaluate(() => {
    const flags = (window as unknown as { __wheelDefaultsPrevented: boolean[] })
      .__wheelDefaultsPrevented
    flags.length = 0
  })
}

export async function lastWheelPrevented(page: Page) {
  return page.evaluate(() => {
    const flags = (window as unknown as { __wheelDefaultsPrevented: boolean[] })
      .__wheelDefaultsPrevented
    return flags.length > 0 ? flags[flags.length - 1] : null
  })
}

/** Real Tab presses from the document start until a left-rail row has focus. */
export async function tabToRailRow(page: Page): Promise<string | null> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.keyboard.press('Tab')
    const label = await page.evaluate(() => {
      const focused = document.activeElement as HTMLElement | null
      if (!focused?.closest('aside nav')) return null
      return focused.getAttribute('aria-label')
    })
    if (label) return label
  }
  return null
}

/**
 * Reach a route whose rail offers another mode. `/settings` guards itself with a
 * loader that runs during SSR, where the mocked session does not apply, so it has
 * to be reached through the app rather than by a full page load.
 */
export async function gotoOtherMode(page: Page) {
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()
  await page.locator('button[aria-haspopup="menu"]').click()
  await page.getByRole('menuitem', { name: 'Settings' }).click()
  await expect(page).toHaveURL(/\/settings$/)
}
