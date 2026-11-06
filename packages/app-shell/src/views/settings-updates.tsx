import type { UserRole } from '@obiter/contracts'
import { Switch } from '@obiter/ui'
import { useUpdatePolicy, useChangeUpdatePolicy } from '../update-policy'
import { ErrorNotice, SectionHeading } from './settings-fields'

export function OrganisationUpdates({
  organisationId,
  role,
}: {
  organisationId: string
  role: UserRole | null
}) {
  const policy = useUpdatePolicy(organisationId)
  const change = useChangeUpdatePolicy(organisationId)
  return (
    <section className="flex max-w-[520px] flex-col gap-4">
      <SectionHeading
        id="settings-updates-heading"
        level="h3"
        title="Updates"
        description="When a new version is ready, everyone in the organisation must update before continuing. Unsaved work is saved first."
      />
      <Switch
        label="Require updates"
        checked={policy.data?.requireUpdates ?? false}
        disabled={
          policy.isPending ||
          !!policy.error ||
          change.isPending ||
          (role !== 'owner' && role !== 'admin')
        }
        onCheckedChange={(checked) =>
          change.mutate({ requireUpdates: checked })
        }
      >
        Require updates
      </Switch>
      {policy.error || change.error ? (
        <ErrorNotice
          message={
            (policy.error ?? change.error)?.message ??
            'Unable to change update policy.'
          }
        />
      ) : null}
    </section>
  )
}
