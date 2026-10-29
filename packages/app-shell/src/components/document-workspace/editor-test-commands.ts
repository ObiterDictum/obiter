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
  Header: 'Insert',
  Footer: 'Insert',
  'Page number': 'Insert',
  'Table of contents': 'Insert',
  'Table of authorities': 'Insert',
  'Update table of authorities': 'Insert',
  'Insert authority': 'Insert',
  'Mark defined term': 'Insert',
  'Find and replace': 'Edit',
  'All commands': 'Edit',
  Cut: 'Edit',
  Copy: 'Edit',
  Paste: 'Edit',
  'Insert paragraph': 'Edit',
  'Delete paragraph': 'Edit',
  Print: 'File',
  Export: 'File',
  'Share-safe export': 'File',
  'Compare versions': 'File',
  'Redact this document': 'File',
  'Document information': 'File',
  'Verify citations': 'Review',
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

function queryCommands(name: string | RegExp) {
  return COMMAND_ROLES.flatMap((role) => screen.queryAllByRole(role, { name }))
}

export function command(name: string | RegExp): HTMLElement {
  const matches = queryCommands(name)
  const visible = matches.find((element) => !element.closest('[hidden]'))
  if (visible) return visible
  const matched =
    typeof name === 'string'
      ? name
      : Object.keys(COMMAND_HOME).find((key) => name.test(key))
  // SAFETY: `matched` can only be a string key of COMMAND_HOME, whether it was
  const home = matched
    ? COMMAND_HOME[matched as keyof typeof COMMAND_HOME]
    : undefined
  const open = (surface: string) => {
    const trigger = screen.getByRole('button', {
      name: new RegExp(`^${surface}$`),
    })
    if (trigger.getAttribute('aria-expanded') === 'true') return
    fireEvent.click(trigger)
  }
  if (home === 'formatting') {
    open('Font, paragraph and page')
  } else if (home) {
    open(home)
  } else {
    for (const surface of [
      'File',
      'Edit',
      'Insert',
      'Format',
      'Review',
      'View',
    ]) {
      open(surface)
      if (queryCommands(name).some((element) => !element.closest('[hidden]'))) {
        break
      }
    }
  }
  const found = queryCommands(name)
  if (!found[0]) throw new Error(`no command ${String(name)}`)
  return found[0]
}

export function commandPrefix(prefix: string): HTMLElement {
  const visible = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (visible) return visible
  const home = Object.keys(COMMAND_HOME).find((key) => key.startsWith(prefix))
  if (home) {
    // SAFETY: `home` came from Object.keys(COMMAND_HOME), so indexing with it
    const target = COMMAND_HOME[home as keyof typeof COMMAND_HOME]
    if (target === 'formatting') {
      fireEvent.click(
        screen.getByRole('button', { name: 'Font, paragraph and page' }),
      )
    } else {
      fireEvent.click(
        screen.getByRole('button', { name: new RegExp(`^${target}$`) }),
      )
    }
  }
  // SAFETY: `home` is one of the literal COMMAND_HOME values, each of which
  const found = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (!found) throw new Error(`no ${prefix}`)
  return found
}

export function commandOrNull(name: string | RegExp): HTMLElement | null {
  const matches = queryCommands(name)
  const visible = matches.find((element) => !element.closest('[hidden]'))
  if (visible) return visible
  try {
    return command(name)
  } catch {
    return null
  }
}

const MENU_OF_TAB = {
  Home: 'Format',
  Insert: 'Insert',
  Layout: 'Format',
  References: 'Insert',
  Review: 'Review',
  View: 'View',
  Edit: 'Edit',
  File: 'File',
} as const

export function openRibbonTab(name: keyof typeof MENU_OF_TAB) {
  const workspace = document.getElementById('document-workspace')
  if (workspace) fireEvent.keyDown(workspace, { key: 'f', ctrlKey: true })
  if (name === 'Home' || name === 'Layout') {
    fireEvent.click(
      screen.getByRole('button', { name: 'Font, paragraph and page' }),
    )
    return
  }
  fireEvent.click(
    screen.getByRole('button', { name: new RegExp(`^${MENU_OF_TAB[name]}$`) }),
  )
}

export function commandReason(element: HTMLElement) {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

export function commandDisabled(element: HTMLElement) {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
}

export function trackChangesSwitch() {
  return screen.getByRole('switch', { name: 'Track changes' })
}

export function setTrackChanges(on: boolean) {
  const toggle = trackChangesSwitch()
  if ((toggle.getAttribute('aria-checked') === 'true') !== on) {
    fireEvent.click(toggle)
  }
}

export function menuItem(name: string | RegExp) {
  const match = queryCommands(name).find(
    (element) => element.getAttribute('role')?.startsWith('menuitem') === true,
  )
  if (!match) throw new Error(`no menu row ${String(name)}`)
  return match
}
