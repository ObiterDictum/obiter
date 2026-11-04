import { expect, type Page } from '@playwright/test'

const MENU_OF_TAB: Record<string, string> = {
  Home: 'Format',
  Layout: 'Format',
  Insert: 'Insert',
  References: 'Insert',
  Review: 'Review',
  View: 'View',
  Edit: 'Edit',
  File: 'File',
}

export async function openMenu(page: Page, label: string) {
  const trigger = page.getByRole('button', { name: label, exact: true }).first()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
  await expect(page.getByRole('menu', { name: label })).toBeVisible()
}

export async function closeMenu(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

export async function openFormatting(page: Page) {
  const panel = page.getByRole('dialog', { name: 'Font, paragraph and page' })
  if (!(await panel.isVisible().catch(() => false))) {
    await page
      .getByRole('button', { name: 'Font, paragraph and page', exact: true })
      .first()
      .click()
  }
  await expect(panel).toBeVisible()
}

export async function openRibbonTab(page: Page, name: string) {
  if (name === 'Home' || name === 'Layout') {
    await openFormatting(page)
    return
  }
  await openMenu(page, MENU_OF_TAB[name] ?? name)
}

export async function toggleCommand(page: Page, menu: string, command: string) {
  await openMenu(page, menu)
  await menuItem(page, command).click()
  await closeMenu(page)
}

export function menuItem(page: Page, name: string) {
  return page
    .getByRole('menuitem', { name, exact: true })
    .or(page.getByRole('menuitemcheckbox', { name, exact: true }))
    .or(page.getByRole('menuitemradio', { name, exact: true }))
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
    const clicked = await menuItem(page, command)
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
  return page.getByRole('menuitemcheckbox', { name: 'Track changes' })
}

export function trackChangesIndicator(page: Page) {
  return page.locator('[data-track-changes="on"]')
}

export async function setTrackChanges(page: Page, on: boolean) {
  const indicator = trackChangesIndicator(page)
  await expect(
    page.getByRole('button', { name: 'Bold', exact: true }).first(),
  ).toBeEnabled()
  await openMenu(page, 'Review')
  const item = page.getByRole('menuitemcheckbox', { name: 'Track changes' })
  await expect(item).toBeEnabled()
  const pressed = (await item.getAttribute('aria-checked')) === 'true'
  if (pressed !== on) await item.click()
  await closeMenu(page)
  await expect(indicator).toHaveCount(on ? 1 : 0)
}
