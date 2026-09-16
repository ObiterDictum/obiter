import { test, expect, type Page } from '@playwright/test'

/**
 * Shell chrome responsive regression.
 *
 * The shell mode bar used to be wider than a narrow viewport: the four mode
 * controls could not shrink, the nav had no scroll containment, and the header
 * grew the document (scrollWidth 450 at a 390px viewport) and drew the last
 * modes over the account controls. This measures the real rendered layout at
 * every supported width and fails if the document widens beyond the viewport,
 * if a mode is covered by other chrome, or if a mode cannot be activated.
 *
 * Auth is mocked at the network boundary so the test needs no account, no
 * database and no email; the layout under measurement is the app's own.
 */
const WIDTHS = [320, 390, 768, 1024, 1440]
const MODES = [
  { name: 'Search', path: '/search' },
  { name: 'Matters', path: '/matters' },
  { name: 'Verify', path: '/verify' },
  { name: 'Redact', path: '/redact' },
] as const

const LONG_NAME = 'Alexandra-Cassandra Montgomery-Fitzwilliam III'
const LONG_ORG = 'Montgomery, Fitzwilliam and Partners International LLP'

async function mockSession(page: Page, name = 'Shell Nominal', org = 'Obiter') {
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

function modeNav(page: Page) {
  return page.getByRole('navigation', { name: 'Modes' })
}

test('shell chrome fits every supported width and every mode stays reachable', async ({
  page,
}) => {
  await mockSession(page)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(100)

    const layout = await page.evaluate(() => {
      const doc = document.documentElement
      const nav = document.querySelector('nav[aria-label="Modes"]')
      const rail = nav?.parentElement ?? null
      const account = document.querySelector('button[aria-haspopup="menu"]')
      const railRect = rail?.getBoundingClientRect()
      const accountRect = account?.getBoundingClientRect()
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        railRight: railRect?.right ?? null,
        accountLeft: accountRect?.left ?? null,
      }
    })

    expect(
      layout.scrollWidth,
      `document scrolls horizontally at ${width}px (scrollWidth ${layout.scrollWidth}, clientWidth ${layout.clientWidth})`,
    ).toBeLessThanOrEqual(layout.clientWidth)
    expect(
      layout.railRight,
      `mode rail overlaps the account controls at ${width}px`,
    ).toBeLessThanOrEqual(layout.accountLeft ?? 0)

    for (const mode of MODES) {
      const link = modeNav(page).getByRole('link', { name: mode.name })
      await expect(link).toHaveCount(1)
      await link.focus()
      await expect(link).toBeFocused()

      // A focused mode must be on-screen inside its rail, not covered by the
      // account controls, and must activate. Covering is what made the last
      // modes unreachable before the fix, so hit-test rather than trust CSS.
      const state = await link.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const top = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        )
        return {
          left: r.left,
          right: r.right,
          covered: !(el === top || el.contains(top)),
        }
      })
      expect(
        state.left,
        `mode ${mode.name} off-screen at ${width}px`,
      ).toBeGreaterThanOrEqual(-1)
      expect(
        state.right,
        `mode ${mode.name} extends past the viewport at ${width}px`,
      ).toBeLessThanOrEqual(width + 1)
      expect(
        state.covered,
        `mode ${mode.name} is covered by other chrome at ${width}px`,
      ).toBe(false)
    }
  }
})

test('every mode is announced as current when its route is active', async ({
  page,
}) => {
  await mockSession(page)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 800 })

  for (const mode of MODES) {
    const link = modeNav(page).getByRole('link', { name: mode.name })
    await link.click()
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
})

test('the account menu opens inside a narrow viewport with long names', async ({
  page,
}) => {
  await mockSession(page, LONG_NAME, LONG_ORG)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()
  await page.setViewportSize({ width: 320, height: 800 })

  await page.locator('button[aria-haspopup="menu"]').click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()

  const layout = await page.evaluate(() => {
    const doc = document.documentElement
    const menu = document.querySelector('[role="menu"]')
    const r = menu?.getBoundingClientRect()
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      menuLeft: r?.left ?? null,
      menuRight: r?.right ?? null,
    }
  })
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  expect(layout.menuLeft).toBeGreaterThanOrEqual(-1)
  expect(layout.menuRight).toBeLessThanOrEqual(321)
})
