import { expect, type Page } from '@playwright/test'

const TAB_OF_NAME: Record<string, string> = {
  Home: 'Format',
  Layout: 'Format',
  Insert: 'Insert',
  References: 'Insert',
  Review: 'Review',
  View: 'View',
  Edit: 'Edit',
  Format: 'Format',
  File: 'File',
}

export async function openMenu(page: Page, label: string) {
  const target = TAB_OF_NAME[label] ?? label
  if (target === 'File') {
    const trigger = page.getByRole('button', { name: 'File', exact: true })
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click()
    }
    await expect(page.getByRole('menu', { name: 'File' })).toBeVisible()
    return
  }
  const tab = page.getByRole('tab', { name: target, exact: true })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: target })).toBeVisible()
}

export async function closeMenu(page: Page) {
  if ((await page.getByRole('menu').count()) === 0) return
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

export async function openFormatting(page: Page) {
  const panel = page.getByRole('dialog', { name: 'Font, paragraph and page' })
  if (await panel.isVisible().catch(() => false)) {
    await expect(panel).toBeVisible()
    return
  }
  const launcher = page.getByRole('button', {
    name: 'Font, paragraph and page',
    exact: true,
  })
  if (!(await launcher.isVisible().catch(() => false))) {
    await openMenu(page, 'Format')
  }
  await launcher.first().click()
  await expect(panel).toBeVisible()
}

export async function openRibbonTab(page: Page, name: string) {
  if (name === 'Home' || name === 'Layout') {
    await openFormatting(page)
    return
  }
  await openMenu(page, name)
}

export async function toggleCommand(page: Page, menu: string, command: string) {
  await openMenu(page, menu)
  const target =
    menu === 'File' ? popupItem(page, menu, command) : menuItem(page, command)
  await target.click()
  await closeMenu(page)
}

export function menuItem(page: Page, name: string) {
  return page
    .getByRole('menuitem', { name, exact: true })
    .or(page.getByRole('menuitemcheckbox', { name, exact: true }))
    .or(page.getByRole('menuitemradio', { name, exact: true }))
    .or(page.getByRole('button', { name, exact: true }))
    .first()
}

function popupItem(page: Page, menu: string, name: string) {
  const popup = page.getByRole('menu', { name: menu })
  return popup
    .getByRole('menuitem', { name, exact: true })
    .or(popup.getByRole('menuitemcheckbox', { name, exact: true }))
    .or(popup.getByRole('menuitemradio', { name, exact: true }))
    .first()
}

export async function runMenuCommand(
  page: Page,
  menu: string,
  command: string,
) {
  const clicked = await clickMenuItem(page, menu, command)
  if (!clicked) throw new Error(`could not run ${command} from ${menu}`)
  const popup = page.getByRole('menu', { name: menu })
  const staysOpen = await expect(popup)
    .toBeHidden({ timeout: 1_000 })
    .then(() => false)
    .catch(() => true)
  if (staysOpen) await closeMenu(page)
}

export async function clickMenuItem(page: Page, menu: string, command: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openMenu(page, menu)
    const target =
      menu === 'File' ? popupItem(page, menu, command) : menuItem(page, command)
    const clicked = await target
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (clicked) return true
  }
  return false
}

export async function choose(page: Page, control: string, option: string) {
  const field = page.getByRole('combobox', { name: control, exact: true })
  if (!(await field.isVisible().catch(() => false))) await openFormatting(page)
  await field.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

export function selectedValue(page: Page, control: string) {
  return page.getByRole('combobox', { name: control, exact: true })
}

export function trackChangesItem(page: Page) {
  return page.getByRole('button', { name: 'Track changes', exact: true })
}

export function trackChangesIndicator(page: Page) {
  return page.locator('[data-track-changes="on"]')
}

async function selectedTab(page: Page) {
  return (await page.getByRole('tab', { selected: true }).textContent())?.trim()
}

export async function setTrackChanges(page: Page, on: boolean) {
  const indicator = trackChangesIndicator(page)
  const previous = await selectedTab(page)
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeVisible()
  await openMenu(page, 'Review')
  const item = trackChangesItem(page)
  await expect(item).toBeEnabled()
  const pressed = (await item.getAttribute('aria-pressed')) === 'true'
  if (pressed !== on) await item.click()
  await closeMenu(page)
  await expect(indicator).toHaveCount(on ? 1 : 0)
  if (previous && previous !== 'Review') await openMenu(page, previous)
}
