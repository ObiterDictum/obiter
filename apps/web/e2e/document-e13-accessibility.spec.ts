import { expect, test } from '@playwright/test'
import { createAccount, openDocx } from './e13-support'
import {
  documentToolbar,
  openRibbonTab,
  ribbonCommand,
  ribbonTab,
  runCommand,
  setTrackChanges,
  trackChangesIndicator,
} from './editor-chrome'

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
  await runCommand(page, 'Navigation pane')
  await expect(page.locator('[data-navigation-pane]')).toBeVisible()
  await runCommand(page, 'Ruler')
  await expect(page.locator('[data-document-ruler]')).toBeVisible()
  const reviewTab = ribbonTab(page, 'Review')
  await reviewTab.focus()
  const outlineWidth = await reviewTab.evaluate(
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
  await expect(await ribbonCommand(page, 'Navigation pane')).toBeVisible()
})

test('every ribbon tab fits the row at 1440×900 with tracking on and off', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 ribbon ${String(Date.now())}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })

  for (const tracking of ['off', 'on'] as const) {
    if (tracking === 'on') await setTrackChanges(page, true)
    for (const name of ['Edit', 'Insert', 'Format', 'Review', 'View']) {
      await openRibbonTab(page, name)
      const widths = await documentToolbar(page).evaluate((toolbar) => ({
        scrollWidth: toolbar.scrollWidth,
        clientWidth: toolbar.clientWidth,
      }))
      expect(
        widths.scrollWidth,
        `the ${name} tab scrolls sideways with tracking ${tracking}`,
      ).toBeLessThanOrEqual(widths.clientWidth)
    }
  }
})

test('announces tracking from the tab strip rather than the ribbon row', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 tracking ${String(Date.now())}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })

  await setTrackChanges(page, true)

  const indicator = trackChangesIndicator(page)
  await expect(indicator).toBeVisible()
  await expect(indicator).toContainText('Track changes on')
  await expect(
    documentToolbar(page).locator('[data-track-changes]'),
  ).toHaveCount(0)
  await expect(
    documentToolbar(page).locator('[data-track-changes]'),
  ).toHaveCount(0)
  const inTabStrip = await indicator.evaluate(
    (node) =>
      node.parentElement?.querySelector('button[aria-current="page"]') !== null,
  )
  expect(inTabStrip, 'the tracking indicator sits in the tab strip').toBe(true)
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
      for (const name of [
        'Zoom out',
        'Zoom in',
        'Ruler',
        'Navigation pane',
        'Print layout',
        'Web layout',
      ]) {
        const control = await ribbonCommand(page, name)
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        expect(box, `${name} has no box`).not.toBeNull()
        expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44)
        expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44)
      }
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
