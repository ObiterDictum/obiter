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
  await openMenu(page, menu)
  await menuItem(page, command).click()
  const popup = page.getByRole('menu', { name: menu })
  if (await popup.isVisible().catch(() => false)) await closeMenu(page)
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

export function trackChangesSwitch(page: Page) {
  return page.getByRole('switch', { name: 'Track changes' })
}

export async function setTrackChanges(page: Page, on: boolean) {
  const toggle = trackChangesSwitch(page)
  if ((await toggle.isChecked()) !== on) await toggle.click()
  await expect(toggle).toBeChecked({ checked: on })
}
