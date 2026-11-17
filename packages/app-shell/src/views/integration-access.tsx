import type { ReactNode } from 'react'
import { Switch } from '@obiter/ui'
import type { Integration } from '../integrations-catalogue'
import { BARE_SWITCH } from './integration-capabilities'
import { SectionHeading } from './settings-fields'

const APPROVAL = 'Ask before the agent sends or changes anything'
const AUDIT_NOTE =
  'Every action the agent takes through this integration is recorded in the matter history.'

function ignore() {}

export function IntegrationAccess({
  integration,
  organisationName,
  canManage,
  approvalOn,
}: {
  integration: Integration
  organisationName: string
  canManage: boolean
  approvalOn: boolean
}) {
  return (
    <aside
      aria-labelledby="integration-access-heading"
      className="flex flex-col gap-5 rounded-lg bg-surface p-6 shadow-sm ring-1 ring-line"
    >
      <SectionHeading
        id="integration-access-heading"
        level="h3"
        title="Access and safety"
        description="Who may use it, and what leaves Obiter."
      />
      <div className="flex flex-col divide-y divide-line">
        <AccessRow
          title="Who can use it"
          detail={`All members of ${organisationName}`}
          note={
            canManage ? undefined : 'Only an owner or admin can change this.'
          }
        />
        <AccessRow
          title={APPROVAL}
          detail="The agent asks first, every time."
          control={
            <Switch
              label={APPROVAL}
              checked
              onCheckedChange={ignore}
              disabled
              className={
                approvalOn
                  ? BARE_SWITCH
                  : `${BARE_SWITCH} aria-disabled:opacity-45`
              }
            />
          }
        />
        <AccessRow title="What leaves Obiter" detail={integration.dataLeaves} />
      </div>
      <p className="text-caption text-subtle">{AUDIT_NOTE}</p>
    </aside>
  )
}

function AccessRow({
  title,
  detail,
  note,
  control,
}: {
  title: string
  detail: string
  note?: string
  control?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-meta text-ink">{title}</p>
        <p className="text-caption text-muted">{detail}</p>
        {note ? <p className="text-caption text-subtle">{note}</p> : null}
      </div>
      {control ? <div className="shrink-0 pt-0.5">{control}</div> : null}
    </div>
  )
}
