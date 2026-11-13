import { expect, test } from '@playwright/test'
import { createAccount, openDocx } from './e13-support'
import { documentToolbar } from './editor-chrome'
import {
  allMattersItem,
  breadcrumb,
  contentsCrumb,
  matterContents,
  matterSwitcherMenu,
  sidebar,
  topBar,
  topBarMatterName,
  topBarTab,
  topBarTabs,
} from './shell-harness'

test.use({ viewport: { width: 1440, height: 900 } })

test('an open document carries its tabs in the top bar and leaves the breadcrumb out', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matterName = `Shell top bar ${String(Date.now())}`
  await openDocx(page, email, password, matterName)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })

  await expect(topBarTabs(page)).toBeVisible()
  await expect(breadcrumb(page)).toHaveCount(0)
  await expect(topBarTab(page, 'e4-lists-styles.docx')).toHaveAttribute(
    'aria-current',
    'page',
  )

  const strip = page.locator('#app-shell-matter-tabs')
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('#app-shell-title-bar')
          ?.contains(document.querySelector('#app-shell-matter-tabs')) ?? false,
    ),
    'the tabs are not in the top bar',
  ).toBe(true)
  expect(
    await page.evaluate(
      () =>
        document
          .querySelector('#app-shell-pane')
          ?.contains(document.querySelector('#app-shell-matter-tabs')) ?? false,
    ),
    'the tabs are still in the workspace column',
  ).toBe(false)

  const headerBox = await topBar(page).boundingBox()
  const stripBox = await strip.boundingBox()
  const toolbarBox = await documentToolbar(page).boundingBox()
  const paneBox = await page.locator('#app-shell-pane').boundingBox()
  expect(Math.round(stripBox?.height ?? 0)).toBe(
    Math.round(headerBox?.height ?? -1),
  )
  expect(
    Math.abs(Math.round(toolbarBox?.top ?? 0) - Math.round(paneBox?.top ?? -1)),
    'the page does not start on the ribbon row',
  ).toBeLessThanOrEqual(2)

  await expect(matterContents(page)).toBeVisible()
  await expect(contentsCrumb(page)).toBeVisible()
  await expect(
    matterContents(page).getByRole('button', {
      name: `Switch matter, current matter ${matterName}`,
    }),
  ).toBeVisible()
  await expect(
    topBar(page).getByRole('button', { name: 'Collapse sidebar' }),
  ).toBeVisible()
  await expect(
    sidebar(page).getByRole('button', { name: 'Collapse sidebar' }),
  ).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(matterContents(page)).toHaveCount(0)
  await expect(topBarMatterName(page)).toBeVisible()
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth)

  await topBarMatterName(page).click()
  await expect(matterSwitcherMenu(page)).toBeVisible()
  await expect(allMattersItem(page)).toBeVisible()
})
