import { expect, type Page } from '@playwright/test'

/*
 * The editor chrome the specs drive. The ribbon's tabs are gone: every command
 * is a row in a menu bar, a control on one compact toolbar, or a value in the
 * formatting panel. These helpers are the one place that knows where each
 * surface is and how a Base UI control is operated, so a spec says what the
 * user does ("apply a font", "turn tracking on") rather than how the chrome is
 * shaped this month.
 */

/** Where a former ribbon tab's commands live now. */
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

/** The menu bar trigger for a menu, opened and settled. */
export async function openMenu(page: Page, label: string) {
  const trigger = page.getByRole('button', { name: label, exact: true }).first()
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
    await trigger.click()
  }
  await expect(page.getByRole('menu', { name: label })).toBeVisible()
}

/** Escape closes the open menu and leaves the document editable. */
export async function closeMenu(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** The formatting panel that holds the controls needing a value. */
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

export async function closeFormatting(page: Page) {
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('dialog', { name: 'Font, paragraph and page' }),
  ).toBeHidden()
}

/**
 * Open the surface that holds a former tab's commands: Home and Layout values
 * are in the formatting panel, everything else is a menu.
 */
export async function openRibbonTab(page: Page, name: string) {
  if (name === 'Home' || name === 'Layout') {
    await openFormatting(page)
    return
  }
  await openMenu(page, MENU_OF_TAB[name] ?? name)
}

/**
 * Run a command that keeps its menu open (an on/off toggle or a choice), then
 * close the menu so the next gesture is on the document.
 */
export async function toggleCommand(page: Page, menu: string, command: string) {
  await openMenu(page, menu)
  await menuItem(page, command).click()
  await closeMenu(page)
}

/**
 * A command row in an open menu, whatever the row's role: a command, an
 * on/off toggle (`menuitemcheckbox`) or a choice (`menuitemradio`).
 */
export function menuItem(page: Page, name: string) {
  return page
    .getByRole('menuitem', { name, exact: true })
    .or(page.getByRole('menuitemcheckbox', { name, exact: true }))
    .or(page.getByRole('menuitemradio', { name, exact: true }))
    .first()
}

/** Run a command from the menu that holds it, leaving no menu open. */
export async function runMenuCommand(
  page: Page,
  menu: string,
  command: string,
) {
  await openMenu(page, menu)
  await menuItem(page, command).click()
  // A toggle keeps its menu open by design; a plain command closes it.
  const popup = page.getByRole('menu', { name: menu })
  if (await popup.isVisible().catch(() => false)) await closeMenu(page)
}

/**
 * Choose a value from a Base UI select: the trigger opens a listbox and the
 * option row commits. `option` is the visible option label, which is what a
 * reader picks; the stored value is the contract's business.
 */
export async function choose(page: Page, control: string, option: string) {
  const field = page.getByRole('combobox', { name: control, exact: true })
  // The value controls live in the formatting panel, which is opened the way
  // a reader opens it — never left open across a document click.
  if (!(await field.isVisible().catch(() => false))) await openFormatting(page)
  await field.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** The value a select currently shows, as its option label. */
export function selectedValue(page: Page, control: string) {
  return page.getByRole('combobox', { name: control, exact: true })
}

/** The one tracking control: the header switch. */
export function trackChangesSwitch(page: Page) {
  return page.getByRole('switch', { name: 'Track changes' })
}

/** Turn tracked changes on or off, whatever the current state is. */
export async function setTrackChanges(page: Page, on: boolean) {
  const toggle = trackChangesSwitch(page)
  if ((await toggle.isChecked()) !== on) await toggle.click()
  await expect(toggle).toBeChecked({ checked: on })
}

/** The command palette, reached the way the product offers it. */
export async function openPalette(page: Page) {
  await page.keyboard.press('Control+k')
  await expect(
    page.getByRole('dialog', { name: 'Editor commands' }),
  ).toBeVisible()
}
