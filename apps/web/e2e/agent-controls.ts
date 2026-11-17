import type { Page } from '@playwright/test'

export function agentModelOption(page: Page, name: RegExp) {
  return page.getByRole('menuitem', { name })
}
