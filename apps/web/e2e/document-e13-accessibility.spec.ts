import { expect, test } from '@playwright/test'
import { createAccount, openDocx, openRibbonTab } from './e13-support'

/*
 * E13 browser coverage, accessibility family: reduced-motion and forced
 * colours keep the ribbon usable, a tablet viewport introduces no horizontal
 * overflow, and the coarse-pointer describe proves the touch-target classes
 * compute to at least 44px under a real coarse pointer and a zoom-scale
 * viewport. Shared journey helpers live in e13-support.ts.
 */

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
  // Ribbon tabs still drive panels under both platform modes.
  await openRibbonTab(page, 'View')
  await page.getByRole('button', { name: 'Navigation pane' }).click()
  await expect(page.locator('[data-navigation-pane]')).toBeVisible()
  await page.getByRole('button', { name: 'Ruler' }).click()
  await expect(page.locator('[data-document-ruler]')).toBeVisible()
  // Focus stays visibly outlined: tab to a control and check the outline.
  const tab = page.getByRole('tab', { name: 'Review', exact: true }).first()
  await tab.focus()
  const outlineWidth = await tab.evaluate(
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
  // The ribbon wraps rather than clipping its controls off the edge.
  await openRibbonTab(page, 'View')
  await expect(
    page.getByRole('button', { name: 'Navigation pane' }),
  ).toBeVisible()
})

test.describe('coarse pointer and zoomed viewport', () => {
  // `isMobile`/`hasTouch` make Chromium report a coarse primary pointer — the
  // media query the pointer-coarse utilities answer to — and the shrunken
  // viewport stands in for a ~200% browser zoom, which Playwright cannot
  // drive directly.
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

    // The media the pointer-coarse utilities respond to is genuinely active,
    // so the assertions below measure the coarse-pointer classes, not hope.
    expect(
      await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    ).toBe(true)

    const assertTargets = async () => {
      for (const name of [
        'Zoom out',
        'Zoom in',
        'Ruler',
        'Navigation pane',
        'Print layout',
        'Web layout',
      ]) {
        const control = page.getByRole('button', { name })
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        expect(box, `${name} has no box`).not.toBeNull()
        expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44)
      }
    }

    await openRibbonTab(page, 'View')
    await assertTargets()

    // A ~200%-zoomed 820px window is a ~410px CSS viewport: controls must
    // stay reachable and sized, and the document column must not overflow.
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
