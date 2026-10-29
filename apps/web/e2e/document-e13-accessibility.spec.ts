import { expect, test } from '@playwright/test'
import { createAccount, openDocx, openRibbonTab } from './e13-support'
import { closeMenu, menuItem } from './editor-chrome'

test.use({ viewport: { width: 1440, height: 900 } })

test('reduced-motion and forced-colours keep the ribbon usable', async ({
  page,
  request,
}) => {
  await page.emulateMedia({
    reducedMotion: 'reduce',
    forcedColors: 'active',
  })
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 a11y ${Date.now()}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openRibbonTab(page, 'View')
  await menuItem(page, 'Navigation pane').click()
  await expect(page.locator('[data-navigation-pane]')).toBeVisible()
  await menuItem(page, 'Ruler').click()
  await expect(page.locator('[data-document-ruler]')).toBeVisible()
  await closeMenu(page)
  const menuTrigger = page.getByRole('button', { name: 'Review', exact: true })
  await menuTrigger.focus()
  const outlineWidth = await menuTrigger.evaluate(
    (node) => getComputedStyle(node).outlineWidth,
  )
  expect(Number.parseFloat(outlineWidth)).toBeGreaterThan(0)
})

test('the workspace holds together at tablet width with no horizontal overflow', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 820, height: 1000 })
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 narrow ${Date.now()}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(4)
  await openRibbonTab(page, 'View')
  await expect(menuItem(page, 'Navigation pane')).toBeVisible()
})

test.describe('coarse pointer and zoomed viewport', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 820, height: 1000 },
  })

  test('interactive targets compute to at least 44px and survive a 200% viewport', async ({
    page,
    request,
  }) => {
    const { email, password } = await createAccount(request)
    await openDocx(page, email, password, `E13 touch ${Date.now()}`)
    await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
      timeout: 30_000,
    })

    expect(
      await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    ).toBe(true)

    const assertTargets = async () => {
      await openRibbonTab(page, 'View')
      for (const name of [
        'Zoom out',
        'Zoom in',
        'Ruler',
        'Navigation pane',
        'Print layout',
        'Web layout',
      ]) {
        const control = menuItem(page, name)
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        expect(box, `${name} has no box`).not.toBeNull()
        expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44)
      }
      await closeMenu(page)
    }

    await assertTargets()

    await page.setViewportSize({ width: 410, height: 500 })
    await expect(page.locator('[data-paragraph-id]').first()).toBeVisible()
    await assertTargets()
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(4)
  })
})
