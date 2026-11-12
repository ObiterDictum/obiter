import { fireEvent, screen } from '@testing-library/react'
import type { ByRoleMatcher } from '@testing-library/react'

type CommandHome =
  'File' | 'Edit' | 'Insert' | 'Format' | 'Review' | 'View' | 'formatting'

const COMMAND_HOME = {
  'Page break': 'Insert',
  'Section break': 'Insert',
  'Insert table': 'Insert',
  Picture: 'Insert',
  Link: 'Insert',
  'Cross-reference': 'Insert',
  Footnote: 'Insert',
  'Close footnotes': 'Insert',
  Header: 'Insert',
  Footer: 'Insert',
  'Page number': 'Insert',
  'Table of contents': 'Insert',
  'Table of authorities': 'Insert',
  'Update table of authorities': 'Insert',
  'Insert authority': 'Insert',
  'Mark defined term': 'Insert',
  'Citation style': 'Insert',
  'Find and replace': 'Edit',
  'All commands': 'Edit',
  Cut: 'Edit',
  Copy: 'Edit',
  Paste: 'Edit',
  'Insert paragraph': 'Edit',
  'Delete paragraph': 'Edit',
  Print: 'File',
  Save: 'File',
  Export: 'File',
  'Share-safe export': 'File',
  'Compare versions': 'File',
  'Redact this document': 'File',
  'Document information': 'File',
  'Verify citations': 'Review',
  'Check citations': 'Review',
  'Track changes': 'Review',
  Comments: 'Review',
  Changes: 'Review',
  'List of authorities': 'Review',
  'Check defined terms': 'Review',
  'Check cross-references': 'Review',
  Spelling: 'Review',
  'Previous change': 'Review',
  'Next change': 'Review',
  'Accept change': 'Review',
  'Reject change': 'Review',
  'Accept all changes': 'Review',
  'Reject all changes': 'Review',
  'Accept all supported changes': 'Review',
  'Reject all supported changes': 'Review',
  Font: 'formatting',
  'Font size': 'formatting',
  'Font colour': 'formatting',
  Strikethrough: 'formatting',
  Highlight: 'formatting',
  Superscript: 'formatting',
  Subscript: 'formatting',
  'Clear formatting': 'formatting',
  'Line spacing': 'formatting',
  Indent: 'formatting',
  Margins: 'formatting',
  'Page size': 'formatting',
  Orientation: 'formatting',
  'Document type': 'formatting',
  Draft: 'formatting',
  Privileged: 'formatting',
  'Without prejudice': 'formatting',
  'Multilevel numbering': 'formatting',
  'Increase list indent': 'formatting',
  'Decrease list indent': 'formatting',
  'Continue list': 'formatting',
  'Restart numbering': 'formatting',
} satisfies Record<string, CommandHome>

const COMMAND_ROLES = [
  'button',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
] as const satisfies readonly ByRoleMatcher[]

const FORMATTING_PANEL = 'Font, paragraph and page'

function queryCommands(name: string | RegExp) {
  return COMMAND_ROLES.flatMap((role) => screen.queryAllByRole(role, { name }))
}

function visibleCommand(name: string | RegExp) {
  return queryCommands(name).find((element) => !element.closest('[hidden]'))
}

function selectTab(label: string) {
  const tab = screen.queryByRole('tab', { name: label })
  if (!tab) return
  if (tab.getAttribute('aria-selected') !== 'true') fireEvent.click(tab)
}

function openFileMenu() {
  if (screen.queryByRole('menu', { name: 'File' })) return
  fireEvent.click(screen.getByRole('button', { name: 'File' }))
}

export function formattingPanelOpen() {
  return screen.queryByRole('dialog', { name: FORMATTING_PANEL }) !== null
}

export function openFormattingPanel() {
  if (formattingPanelOpen()) return
  selectTab('Format')
  fireEvent.click(screen.getByRole('button', { name: FORMATTING_PANEL }))
}

function openSurface(surface: CommandHome) {
  if (surface === 'formatting') openFormattingPanel()
  else if (surface === 'File') openFileMenu()
  else selectTab(surface)
}

export function command(name: string | RegExp): HTMLElement {
  const visible = visibleCommand(name)
  if (visible) return visible
  const matched =
    typeof name === 'string'
      ? name
      : Object.keys(COMMAND_HOME).find((key) => name.test(key))
  // SAFETY: `matched` can only be a string key of COMMAND_HOME, whether it was
  const home = matched
    ? COMMAND_HOME[matched as keyof typeof COMMAND_HOME]
    : undefined
  if (home) {
    openSurface(home)
  } else {
    for (const surface of [
      'File',
      'Edit',
      'Insert',
      'Format',
      'Review',
      'View',
    ] as const) {
      openSurface(surface)
      if (visibleCommand(name)) break
    }
  }
  const found = visibleCommand(name) ?? queryCommands(name)[0]
  if (!found) throw new Error(`no command ${String(name)}`)
  return found
}

export function commandPrefix(prefix: string): HTMLElement {
  const visible = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (visible) return visible
  const home = Object.keys(COMMAND_HOME).find((key) => key.startsWith(prefix))
  if (home) {
    // SAFETY: `home` came from Object.keys(COMMAND_HOME), so indexing with it
    openSurface(COMMAND_HOME[home as keyof typeof COMMAND_HOME])
  }
  const found = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (!found) throw new Error(`no ${prefix}`)
  return found
}

export function commandOrNull(name: string | RegExp): HTMLElement | null {
  const visible = visibleCommand(name)
  if (visible) return visible
  try {
    return command(name)
  } catch {
    return null
  }
}

const TAB_OF_NAME = {
  Home: 'Format',
  Layout: 'Format',
  Format: 'Format',
  Insert: 'Insert',
  References: 'Insert',
  Review: 'Review',
  View: 'View',
  Edit: 'Edit',
} as const

export function openRibbonTab(name: keyof typeof TAB_OF_NAME | 'File') {
  if (name === 'File') {
    openFileMenu()
    return
  }
  if (name === 'Home' || name === 'Layout') {
    openFormattingPanel()
    return
  }
  selectTab(TAB_OF_NAME[name])
}

export function openFindBar() {
  if (screen.queryByLabelText('Find in document')) return
  fireEvent.click(command('Find and replace'))
}

export async function chooseRibbonOption(label: string, option: string) {
  if (!screen.queryByRole('combobox', { name: label })) {
    selectTab('Format')
    if (!screen.queryByRole('combobox', { name: label })) openFormattingPanel()
  }
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const row = await screen.findByRole('option', { name: option })
  fireEvent.focus(row)
  fireEvent.click(row)
}

export function commandReason(element: HTMLElement) {
  const described = (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
  return described || element.getAttribute('title') || ''
}

export function commandDisabled(element: HTMLElement) {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
}

function closeRibbonMenu(name: string) {
  const popup = screen.queryByRole('menu', { name })
  if (popup) fireEvent.keyDown(popup, { key: 'Escape' })
}

export function trackChangesState() {
  return command('Track changes').getAttribute('aria-pressed')
}

export function setTrackChanges(on: boolean) {
  const toggle = command('Track changes')
  if ((toggle.getAttribute('aria-pressed') === 'true') !== on) {
    fireEvent.click(toggle)
  }
  closeRibbonMenu('Review')
}
