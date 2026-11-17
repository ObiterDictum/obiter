import { AgentConnections } from './settings-agent-connections'
import { AnthropicBlock } from './settings-agent-anthropic'
import {
  AGENT_PROVIDERS,
  type MeResponse,
  type UserRole,
} from '@obiter/contracts'
import { Skeleton, Switch } from '@obiter/ui'
import {
  useOrganisationAgentSettings,
  useUpdateOrganisationAgentSettings,
} from '../agent-runs'
import { ErrorNotice, ReadOnlyField, SectionHeading } from './settings-fields'

const ADMIN_ONLY = 'Only an owner or admin can change this.'
export function AgentSection({
  me,
  active,
}: {
  me: MeResponse
  active: boolean
}) {
  const organisation = me.organisation
  if (!organisation) return null
  return (
    <OrganisationAgentSettingsSection
      organisationId={organisation.id}
      role={me.user.role}
      active={active}
    />
  )
}

export function OrganisationAgentSettingsSection({
  organisationId,
  role,
  active,
}: {
  organisationId: string
  role: UserRole | null
  active: boolean
}) {
  const settings = useOrganisationAgentSettings(organisationId)
  const update = useUpdateOrganisationAgentSettings(organisationId)
  const canChange = role === 'owner' || role === 'admin'

  return (
    <section
      id="settings-agent"
      hidden={!active}
      aria-label="Agent"
      className="flex flex-col gap-8"
    >
      <div className="flex max-w-[480px] flex-col gap-6">
        {settings.isPending ? (
          <Skeleton className="h-10" />
        ) : settings.error ? (
          <ErrorNotice message={settings.error.message} />
        ) : canChange ? (
          <>
            <AnthropicBlock
              organisationId={organisationId}
              settings={settings.data}
            />
            <AgentConnections organisationId={organisationId} />
            <div className="flex flex-col gap-4 border-t border-line pt-6">
              <SectionHeading
                id="settings-agent-sharing-heading"
                level="h3"
                title="Matter documents"
                description="Your question always goes to the provider. Matter documents go only if you allow it here."
              />
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
              {update.error ? (
                <ErrorNotice message={update.error.message} />
              ) : null}
            </div>
          </>
        ) : (
          <dl className="flex flex-col gap-4">
            {settings.data.model ? (
              <>
                <ReadOnlyField
                  label="Provider"
                  value={AGENT_PROVIDERS[settings.data.model.provider].label}
                />
                <ReadOnlyField
                  label="Model"
                  value={settings.data.model.modelId}
                  helper={ADMIN_ONLY}
                />
              </>
            ) : (
              <ReadOnlyField
                label="Model"
                value="No model is set for this organisation."
                helper={ADMIN_ONLY}
              />
            )}
            <ReadOnlyField
              label="Send matter documents to the model provider"
              value={settings.data.matterTextToModel ? 'Allowed' : 'Off'}
              helper={ADMIN_ONLY}
            />
          </dl>
        )}
      </div>
    </section>
  )
}
