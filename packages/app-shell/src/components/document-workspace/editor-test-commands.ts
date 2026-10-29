import { fireEvent, screen } from '@testing-library/react'
import type { ByRoleMatcher } from '@testing-library/react'

/**
 * Command lookup for tests: a control by name, opening the chrome surface
 * that holds it when it is not already on screen. Kept in its own module so a
 * test that mocks the workspace's API modules can use it without loading the
 * harness that registers those mocks.
 */
/** Where each command that is not always on screen lives. */
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
  // The value controls live in the formatting panel.
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

/**
 * A command's control, opening the surface that holds it when it is not
 * already on screen. The ribbon's tabs are gone, so a test that used to reveal
 * a control by selecting a tab now reveals it by opening its menu or the
 * formatting panel — the same user action either way.
 */
/**
 * The roles a command can appear under: the toolbar and panel controls are
 * buttons, and a menu row is the menu role Base UI gives it. A command is one
 * control wherever it is offered, so a lookup by name does not care which.
 */
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
  // given directly or found by matching one of those keys with the regex.
  const home = matched
    ? COMMAND_HOME[matched as keyof typeof COMMAND_HOME]
    : undefined
  // A trigger whose menu is already open would be closed by another click,
  // so an open surface is left alone.
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
    // A command with no recorded home (a style, a footnote label that changes
    // with state) is found by opening the menus in order.
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

/**
 * A control found by label prefix, opening the surface that holds it when it
 * is not already on screen. Used where the label carries a state reason.
 */
export function commandPrefix(prefix: string): HTMLElement {
  const visible = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (visible) return visible
  const home = Object.keys(COMMAND_HOME).find((key) => key.startsWith(prefix))
  if (home) {
    // SAFETY: `home` came from Object.keys(COMMAND_HOME), so indexing with it
    // is in bounds.
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
  // names a rendered menu trigger.
  const found = COMMAND_ROLES.flatMap((role) =>
    screen.queryAllByRole(role),
  ).find((element) => element.getAttribute('aria-label')?.startsWith(prefix))
  if (!found) throw new Error(`no ${prefix}`)
  return found
}

/** `command`, or null when the control is not offered in this state. */
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

/**
 * Opens the chrome surface that holds the tab's commands. The ribbon is gone:
 * Home and Layout choices live in the formatting panel, and the rest are rows
 * in the menu bar.
 */
export function openRibbonTab(name: keyof typeof MENU_OF_TAB) {
  // Find moved from a ribbon group into its own bar; Ctrl+F is how the product
  // reveals it now, so the helper reveals it the same way.
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

/** The description a control publishes: why it is disabled, or its hint. */
export function commandReason(element: HTMLElement) {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
}

/** Whether a command's control refuses activation, whatever role it has. */
export function commandDisabled(element: HTMLElement) {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true'
  )
}

/**
 * The one tracking control: the header switch. Its name is constant, so the
 * state is the switch's own checked state rather than part of the name.
 */
export function trackChangesSwitch() {
  return screen.getByRole('switch', { name: 'Track changes' })
}

/** Turn tracking on or off, whatever state it is in. */
export function setTrackChanges(on: boolean) {
  const toggle = trackChangesSwitch()
  if ((toggle.getAttribute('aria-checked') === 'true') !== on) {
    fireEvent.click(toggle)
  }
}

/** A command row in an open menu, whatever role the menu gives it. */
export function menuItem(name: string | RegExp) {
  const match = queryCommands(name).find(
    (element) => element.getAttribute('role')?.startsWith('menuitem') === true,
  )
  if (!match) throw new Error(`no menu row ${String(name)}`)
  return match
}
