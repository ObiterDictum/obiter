import { test, expect } from '@playwright/test'
import {
  documentWidths,
  LONG_NAME,
  LONG_ORG,
  mockSession,
  MODES,
  modeNav,
  WIDTHS,
} from './shell-harness'

/**
 * Shell chrome layout regression.
 *
 * The shell mode bar used to be wider than a narrow viewport: the four mode
 * controls could not shrink, the nav had no scroll containment, and the header
 * grew the document (scrollWidth 450 at a 390px viewport) and drew the last
 * modes over the account controls. This measures the real rendered layout at
 * every supported width and fails if the document widens beyond the viewport, if
 * a mode is covered by other chrome, if a mode cannot be activated, or if a
 * floating panel leaves the viewport.
 *
 * The pointer and keyboard paths into the mode bar and the left rail, which are
 * the mechanisms the narrow-viewport fix rests on, live in mode-rail.spec.ts.
 */
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
      const state = await link.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        const top = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        )
        return {
          left: rect.left,
          right: rect.right,
          covered: !(element === top || element.contains(top)),
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

test('the expanded search panel stays inside the viewport', async ({
  page,
}) => {
  await mockSession(page)

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/search')

    const field = page.getByRole('textbox', { name: 'Search Obiter' })
    await field.click()
    await field.fill('arbitration clause enforcement in the commercial court')

    const dialog = page.getByRole('dialog', { name: 'Expanded search' })
    await expect(dialog).toBeVisible()

    const box = await dialog.boundingBox()
    expect(box, `no expanded search panel at ${width}px`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)

    const widths = await documentWidths(page)
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth)
  }
})

test('the account menu opens inside a narrow viewport with long names', async ({
  page,
}) => {
  await mockSession(page, LONG_NAME, LONG_ORG)
  await page.goto('/search')
  await expect(modeNav(page)).toBeVisible()

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await page.locator('button[aria-haspopup="menu"]').click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    const layout = await page.evaluate(() => {
      const doc = document.documentElement
      const menu = document.querySelector('[role="menu"]')
      const rect = menu?.getBoundingClientRect()
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        menuLeft: rect?.left ?? null,
        menuRight: rect?.right ?? null,
      }
    })
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
    expect(layout.menuLeft).toBeGreaterThanOrEqual(-1)
    expect(layout.menuRight).toBeLessThanOrEqual(width + 1)

    await page.locator('button[aria-label="Close menu"]').click()
  }
})
