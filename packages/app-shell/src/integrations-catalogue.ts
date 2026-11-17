import type { IntegrationMarkKey } from './integration-marks'

export type IntegrationGroupId =
  | 'team-chat'
  | 'email-calendar'
  | 'documents'
  | 'practice'
  | 'signing'
  | 'public-sources'

export interface IntegrationGroup {
  id: IntegrationGroupId
  title: string
}

export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = [
  { id: 'team-chat', title: 'Team chat' },
  { id: 'email-calendar', title: 'Email and calendar' },
  { id: 'documents', title: 'Documents and storage' },
  { id: 'practice', title: 'Practice management' },
  { id: 'signing', title: 'Signing' },
  { id: 'public-sources', title: 'Public sources' },
]

export type IntegrationIconId =
  | 'channel'
  | 'mention'
  | 'post-update'
  | 'direct-message'
  | 'read-mail'
  | 'draft'
  | 'attachment'
  | 'diary'
  | 'find-time'
  | 'deadline'
  | 'files'
  | 'save'
  | 'index'
  | 'matter'
  | 'time'
  | 'task'
  | 'envelope'
  | 'signature'
  | 'company'
  | 'filing'
  | 'title'
  | 'title-plan'
  | 'notice'
  | 'search'
  | 'watch'
  | 'legislation'
  | 'commencement'

export interface IntegrationCapability {
  title: string
  description: string
  icon: IntegrationIconId
}

export type IntegrationVisual =
  | { kind: 'mark'; key: IntegrationMarkKey }
  | { kind: 'lettermark'; letters: string; hex: string }

export type IntegrationLifecycle = 'available' | 'planned'
export type IntegrationStatus = 'connected' | IntegrationLifecycle | 'checking'

export interface Integration {
  id: string
  name: string
  group: IntegrationGroupId
  status: IntegrationLifecycle
  summary: string
  description: string
  visual: IntegrationVisual
  capabilities: readonly IntegrationCapability[]
  dataLeaves: string
  leaves: string
}
export { INTEGRATIONS } from './integrations-catalogue-entries'

const WORKS_WITH = {
  'team-chat': ['Matters', 'Research'],
  'email-calendar': ['Matters', 'Deadlines'],
  documents: ['Matters', 'Documents'],
  practice: ['Matters', 'Billing'],
  signing: ['Matters', 'Signatures'],
  'public-sources': ['Research', 'Due diligence'],
} as const satisfies Record<IntegrationGroupId, readonly string[]>

export function integrationWorksWith(integration: Integration) {
  return WORKS_WITH[integration.group]
}

export function integrationGroupTitle(integration: Integration) {
  const group = INTEGRATION_GROUPS.find((item) => item.id === integration.group)
  return group ? group.title : integration.group
}
