import type { UserRole } from '@obiter/contracts'
import { Skeleton, Switch } from '@obiter/ui'
import {
  useOrganisationAgentSettings,
  useUpdateOrganisationAgentSettings,
} from '../agent-runs'
import { ErrorNotice, ReadOnlyField, SectionHeading } from './settings-fields'

export function OrganisationAgentSettingsSection({
  organisationId,
  role,
}: {
  organisationId: string
  role: UserRole | null
}) {
  const settings = useOrganisationAgentSettings(organisationId)
  const update = useUpdateOrganisationAgentSettings(organisationId)
  const canChange = role === 'owner' || role === 'admin'

  return (
    <section
      aria-labelledby="settings-agent-heading"
      className="flex max-w-[520px] flex-col gap-4"
    >
      <SectionHeading
        id="settings-agent-heading"
        level="h3"
        title="Agent"
        description="The agent answers questions about a matter from the law Obiter holds. Your question always goes to the model provider. Matter documents go only if you allow it here."
      />
      {settings.isPending ? (
        <Skeleton className="h-10" />
      ) : settings.error ? (
        <ErrorNotice message={settings.error.message} />
      ) : (
        <>
          <dl>
            <ReadOnlyField
              label="Model"
              value={
                settings.data.model
                  ? `${settings.data.model.provider} · ${settings.data.model.snapshot}`
                  : 'No model is configured on this server.'
              }
            />
          </dl>
          {canChange ? (
            <Switch
              label="Send matter documents to the model provider"
              checked={settings.data.matterTextToModel}
              disabled={update.isPending}
              onCheckedChange={(checked) =>
                update.mutate({ matterTextToModel: checked })
              }
              className="self-start"
            >
              Send matter documents to the model provider
            </Switch>
          ) : (
            <dl>
              <ReadOnlyField
                label="Send matter documents to the model provider"
                value={settings.data.matterTextToModel ? 'Allowed' : 'Off'}
                helper="Only an owner or admin can change this."
              />
            </dl>
          )}
          {update.error ? <ErrorNotice message={update.error.message} /> : null}
        </>
      )}
    </section>
  )
}
