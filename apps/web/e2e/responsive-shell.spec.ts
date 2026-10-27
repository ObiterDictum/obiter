import { test, expect } from '@playwright/test'
import {
  LONG_NAME,
  LONG_ORG,
  MODULES,
  WIDTHS,
  asideWidth,
  documentWidths,
  gotoOtherMode,
  mockSession,
  sidebar,
  sidebarToggle,
  workspaceNav,
} from './shell-harness'

/**
 * Shell chrome layout regression.
 *
 * The sidebar replaced the top mode bar and the hover-expand icon rail. This
 * measures the real rendered layout at every supported width and fails if the
 * document widens beyond the viewport, if a module is covered by other chrome,
 * if a module cannot be activated, if collapsing the sidebar strands a module,
 * or if a floating surface leaves the viewport.
 */
test('the shell fits every supported width and every module stays reachable', async ({
  page,
}) => {
  await mockSession(page)
  // Entry is /search because a client route's loader runs against the mocked
  // API; a full load of / or /matters is server-rendered and would sign in for
  // real before any route mock applies.
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 })
    await page.waitForTimeout(150)

    const layout = await page.evaluate(() => {
      const doc = document.documentElement
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth }
    })
    expect(
      layout.scrollWidth,
      `document scrolls horizontally at ${width}px (scrollWidth ${layout.scrollWidth}, clientWidth ${layout.clientWidth})`,
    ).toBeLessThanOrEqual(layout.clientWidth)

    for (const module of MODULES) {
      const link = workspaceNav(page).getByRole('link', {
        name: new RegExp(`^${module.name}`),
      })
      await expect(link).toHaveCount(1)
      await link.focus()
      await expect(link).toBeFocused()

      // A focused module must be on-screen, not covered by the top bar, and
      // able to activate. Covering is what made the last modes unreachable in
      // the old rail, so hit-test rather than trust CSS.
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
        `module ${module.name} off-screen at ${width}px`,
      ).toBeGreaterThanOrEqual(-1)
      expect(
        state.right,
        `module ${module.name} extends past the viewport at ${width}px`,
      ).toBeLessThanOrEqual(width + 1)
      expect(
        state.covered,
        `module ${module.name} is covered by other chrome at ${width}px`,
      ).toBe(false)
    }
  }
})

test('every module is announced as current when its route is active', async ({
  page,
}) => {
  await mockSession(page)
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()

  for (const module of MODULES) {
    const link = workspaceNav(page).getByRole('link', {
      name: new RegExp(`^${module.name}`),
    })
    await link.click()
    await expect(link).toHaveAttribute('aria-current', 'page')
  }
})

test('the sidebar collapses to an icon rail and remembers the choice', async ({
  page,
}) => {
  await mockSession(page)
  await page.goto('/search')
  await expect(workspaceNav(page)).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })

  await expect(sidebar(page)).toHaveCSS('width', '252px')
  await (await sidebarToggle(page)).click()
  await expect
    .poll(async () => asideWidth(sidebar(page)))
    .toBeLessThanOrEqual(64)

  // The rail keeps every module as a labelled control, including the ones the
  // expanded sidebar shows with a count.
  for (const module of MODULES) {
    await expect(
      workspaceNav(page).getByRole('link', {
        name: new RegExp(`^${module.name}`),
      }),
    ).toBeVisible()
  }

  await page.reload()
  await expect(workspaceNav(page)).toBeVisible()
  await expect
    .poll(async () => asideWidth(sidebar(page)))
    .toBeLessThanOrEqual(64)

  await (await sidebarToggle(page)).click()
  await expect.poll(async () => asideWidth(sidebar(page))).toBeGreaterThan(200)
})

test('the account menu opens inside a narrow viewport, closes on Escape and returns focus', async ({
  page,
}) => {
  await mockSession(page)

  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/search')
    const trigger = page.getByRole('button', { name: 'Account menu' })
    await trigger.click()

    const menu = page.getByRole('menu', { name: 'Account' })
    await expect(menu).toBeVisible()
    expect(await menu.getByRole('menuitem', { name: 'Sign out' }).count()).toBe(
      1,
    )

    const widths = await documentWidths(page)
    expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth)

    const box = await menu.boundingBox()
    expect(box, `no account menu at ${width}px`).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
  }
})

test('the expanded search panel stays inside the viewport', async ({
  page,
}) => {
  await mockSession(page)

  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('/search')

    // At 1024 and below the field is an icon-only control that opens the
    // composer; above that, the field itself takes the query.
    const field = page.getByRole('textbox', { name: 'Search Obiter' })
    if (await field.isVisible()) {
      await field.click()
      await field.fill('arbitration clause enforcement in the commercial court')
    } else {
      await page.getByRole('button', { name: 'Search Obiter' }).click()
      await page
        .getByRole('textbox', { name: 'Expanded search' })
        .fill('arbitration clause enforcement in the commercial court')
    }

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

test('the account menu survives a long name and organisation', async ({
  page,
}) => {
  await mockSession(page, LONG_NAME, LONG_ORG)
  await page.goto('/search')
  await page.setViewportSize({ width: 320, height: 800 })

  await page.getByRole('button', { name: 'Account menu' }).click()
  const menu = page.getByRole('menu', { name: 'Account' })
  await expect(menu).toBeVisible()

  const layout = await page.evaluate(() => {
    const doc = document.documentElement
    const popup = document.querySelector('[aria-label="Account"]')
    const rect = popup?.getBoundingClientRect()
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      left: rect?.left ?? null,
      right: rect?.right ?? null,
    }
  })
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
  expect(layout.left).toBeGreaterThanOrEqual(-1)
  expect(layout.right).toBeLessThanOrEqual(321)
})

test('settings stays reachable from the account menu', async ({ page }) => {
  await mockSession(page)
  await gotoOtherMode(page)
})
