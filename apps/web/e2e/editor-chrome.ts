import { expect, type Page } from '@playwright/test'

type Surface =
  | 'File'
  | 'Edit'
  | 'Insert'
  | 'Format'
  | 'Review'
  | 'View'
  | 'Font panel'
  | 'Quick access'

type CommandSurface = { tab: Surface; group?: string }

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

const SURFACE_OF_COMMAND: Record<string, CommandSurface> = {
  Save: { tab: 'Quick access' },
  'Citation style': { tab: 'Insert' },
  Undo: { tab: 'Quick access' },
  Redo: { tab: 'Quick access' },
  'Document information': { tab: 'View' },
  'Print layout': { tab: 'View' },
  'Web layout': { tab: 'View' },
  Ruler: { tab: 'View' },
  'Navigation pane': { tab: 'View' },
  'Zoom in': { tab: 'View' },
  'Zoom out': { tab: 'View' },
  'Insert paragraph': { tab: 'Edit' },
  'Delete paragraph': { tab: 'Edit' },
  Cut: { tab: 'Edit' },
  Copy: { tab: 'Edit' },
  Paste: { tab: 'Edit' },
  'Page break': { tab: 'Insert' },
  'Section break': { tab: 'Insert' },
  'Insert table': { tab: 'Insert' },
  'Insert row above': { tab: 'Insert', group: 'Table tools' },
  'Insert row below': { tab: 'Insert', group: 'Table tools' },
  'Insert column left': { tab: 'Insert', group: 'Table tools' },
  'Insert column right': { tab: 'Insert', group: 'Table tools' },
  'Delete row': { tab: 'Insert', group: 'Table tools' },
  'Delete column': { tab: 'Insert', group: 'Table tools' },
  'Delete table': { tab: 'Insert', group: 'Table tools' },
  Link: { tab: 'Insert' },
  'Cross-reference': { tab: 'Insert' },
  Footnote: { tab: 'Insert' },
  'Close footnotes': { tab: 'Insert' },
  Header: { tab: 'Insert' },
  'Close header': { tab: 'Insert' },
  'Page number': { tab: 'Insert' },
  'Table of contents': { tab: 'Insert' },
  'Insert authority': { tab: 'Insert', group: 'Authorities' },
  'Table of authorities': { tab: 'Insert', group: 'Authorities' },
  'Update table of authorities': { tab: 'Insert', group: 'Authorities' },
  'Mark defined term': { tab: 'Insert', group: 'Authorities' },
  Bold: { tab: 'Format' },
  'Track changes': { tab: 'Review' },
  'Accept change': { tab: 'Review' },
  'Reject change': { tab: 'Review' },
  Comments: { tab: 'Review' },
  Changes: { tab: 'Review' },
  'Verify citations': { tab: 'Review' },
  'Check citations': { tab: 'Review' },
  'List of authorities': { tab: 'Review' },
  'Check defined terms': { tab: 'Review' },
  'Check cross-references': { tab: 'Review' },
  Spelling: { tab: 'Review' },
  Export: { tab: 'File' },
  'Share-safe export': { tab: 'File' },
  'Redact this document': { tab: 'File' },
  'Compare versions': { tab: 'File' },
  Print: { tab: 'File' },
  Strikethrough: { tab: 'Font panel' },
  Highlight: { tab: 'Font panel' },
  Superscript: { tab: 'Font panel' },
  Subscript: { tab: 'Font panel' },
  'Clear formatting': { tab: 'Font panel' },
  'Multilevel numbering': { tab: 'Font panel' },
  'Increase list indent': { tab: 'Font panel' },
  'Restart numbering': { tab: 'Font panel' },
  Orientation: { tab: 'Font panel' },
  Draft: { tab: 'Font panel' },
  Privileged: { tab: 'Font panel' },
  'Without prejudice': { tab: 'Font panel' },
}

async function openSurface(page: Page, surface: CommandSurface) {
  if (surface.tab === 'Quick access') return
  if (surface.tab === 'Font panel') {
    await openFormatting(page)
    return
  }
  await openRibbonTab(page, surface.tab)
  if (surface.group) await openRibbonGroup(page, surface.group)
}

async function openMenu(page: Page, label: string) {
  const target = TAB_OF_NAME[label] ?? label
  if (target === 'File') {
    const trigger = page.getByRole('button', { name: 'File', exact: true })
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click()
    }
    await expect(page.getByRole('menu', { name: 'File' })).toBeVisible()
    return
  }
  const tab = ribbonTab(page, target)
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: target })).toBeVisible()
}

async function closeMenu(page: Page) {
  if ((await page.getByRole('menu').count()) === 0) return
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function namePattern(name: string) {
  return new RegExp(`^${escapeRegExp(name)}( \\(\\d+\\))?$`, 'u')
}

function control(page: Page, name: string) {
  const label = namePattern(name)
  return page
    .getByRole('button', { name: label })
    .or(page.getByRole('menuitem', { name: label }))
    .or(page.getByRole('menuitemcheckbox', { name: label }))
    .or(page.getByRole('menuitemradio', { name: label }))
    .first()
}

function surfaceOf(name: string): CommandSurface {
  const surface = SURFACE_OF_COMMAND[name]
  if (!surface) throw new Error(`no editor surface is mapped for ${name}`)
  return surface
}

export function ribbonTab(page: Page, name: string) {
  const target = TAB_OF_NAME[name] ?? name
  return page.getByRole('tab', { name: target, exact: true })
}

export async function openRibbonTab(page: Page, name: string) {
  if (name === 'Home' || name === 'Layout') {
    await openFormatting(page)
    return
  }
  await openMenu(page, name)
}

async function openRibbonGroup(page: Page, group: string) {
  const trigger = page.getByRole('button', { name: group, exact: true })
  const menu = page.getByRole('menu', { name: group })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click()
    }
    const open = await expect(menu)
      .toBeVisible({ timeout: 2_000 })
      .then(() => true)
      .catch(() => false)
    if (open) return
  }
  throw new Error(`could not open the ${group} ribbon group`)
}

async function showing(page: Page, name: string) {
  return (await target(page, name)).isVisible().catch(() => false)
}

async function target(page: Page, name: string) {
  if (surfaceOf(name).tab === 'File') {
    await openMenu(page, 'File')
    return popupItem(page, 'File', name)
  }
  return control(page, name)
}

export async function ribbonCommand(page: Page, name: string) {
  const surface = surfaceOf(name)
  if (surface.tab === 'File') return target(page, name)
  if (!(await showing(page, name))) {
    await openSurface(page, surface)
  }
  return control(page, name)
}

export async function runCommand(page: Page, name: string) {
  const surface = surfaceOf(name)
  if (surface.tab === 'File') {
    const clicked = await clickMenuItem(page, surface, name)
    if (!clicked) throw new Error(`could not run ${name} from the File menu`)
    return
  }
  if (await showing(page, name)) {
    await control(page, name).click({ timeout: 5_000 })
    return
  }
  if (surface.tab === 'Font panel' || surface.tab === 'Quick access') {
    await openSurface(page, surface)
    await control(page, name).click({ timeout: 5_000 })
    return
  }
  const clicked = await clickMenuItem(page, surface, name)
  if (!clicked) {
    throw new Error(`could not run ${name} from the ${surface.tab} ribbon`)
  }
}

export async function commandRefusal(page: Page, name: string) {
  const command = await ribbonCommand(page, name)
  const title = await command.getAttribute('title')
  if (title) return title
  const describedBy = await command.getAttribute('aria-describedby')
  if (!describedBy) return ''
  return (await page.locator(`[id="${describedBy}"]`).textContent())?.trim()
}

export function saveButton(page: Page) {
  return control(page, 'Save')
}

export function undoButton(page: Page) {
  return control(page, 'Undo')
}

export function redoButton(page: Page) {
  return control(page, 'Redo')
}

export function documentToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Document toolbar' })
}

export function allCommandsButton(page: Page) {
  return page.getByRole('button', { name: 'All commands', exact: true })
}

export function editorCommandPalette(page: Page) {
  return page.getByRole('dialog', { name: 'Editor commands' })
}

export function appSearchDialog(page: Page) {
  return page.getByRole('dialog', { name: 'Search Obiter' })
}

export function popupMenus(page: Page) {
  return page.getByRole('menu')
}

export function documentPanelTab(page: Page, name: string) {
  return page.getByRole('tab', { name, exact: true })
}

export async function openReviewPanel(
  page: Page,
  name: 'Changes' | 'Comments',
) {
  await openSurface(page, surfaceOf(name)).catch(() => undefined)
  await control(page, name)
    .click({ timeout: 5_000 })
    .catch(() => undefined)
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

async function clickMenuItem(
  page: Page,
  surface: CommandSurface,
  command: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await openSurface(page, surface)
    const target =
      surface.tab === 'File'
        ? popupItem(page, 'File', command)
        : control(page, command)
    const clicked = await target
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (clicked) return true
  }
  return false
}

function popupItem(page: Page, menu: string, name: string) {
  const popup = page.getByRole('menu', { name: menu })
  const label = namePattern(name)
  return popup
    .getByRole('menuitem', { name: label })
    .or(popup.getByRole('menuitemcheckbox', { name: label }))
    .or(popup.getByRole('menuitemradio', { name: label }))
    .first()
}

export async function choose(page: Page, controlName: string, option: string) {
  const target = await fieldValue(page, controlName)
  await target.click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

export async function chooseStyle(page: Page, style: string) {
  await choose(page, 'Paragraph style', style)
}

export function styleValue(page: Page) {
  return page.getByRole('combobox', { name: 'Paragraph style', exact: true })
}

export function selectedValue(page: Page, controlName: string) {
  return page.getByRole('combobox', { name: controlName, exact: true })
}

export async function fieldValue(page: Page, controlName: string) {
  const target = selectedValue(page, controlName)
  if (!(await target.isVisible().catch(() => false))) {
    const surface = SURFACE_OF_COMMAND[controlName]
    if (surface) await openSurface(page, surface)
    else await openFormatting(page)
  }
  return selectedValue(page, controlName)
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
  await expect(saveButton(page)).toBeVisible()
  await openMenu(page, 'Review')
  const item = control(page, 'Track changes')
  await expect(item).toBeEnabled()
  const pressed = (await item.getAttribute('aria-pressed')) === 'true'
  if (pressed !== on) await item.click()
  await closeMenu(page)
  await expect(indicator).toHaveCount(on ? 1 : 0)
  if (previous && previous !== 'Review') await openMenu(page, previous)
}
