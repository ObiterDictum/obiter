import { useState, type FormEvent } from 'react'
import {
  AGENT_PROVIDERS,
  organisationAgentSettingsUpdateSchema,
  type AgentProvider,
  type MeResponse,
  type OrganisationAgentSettings,
  type UserRole,
} from '@obiter/contracts'
import { Button, Input, Select, Skeleton, Switch } from '@obiter/ui'
import {
  useOrganisationAgentSettings,
  useUpdateOrganisationAgentSettings,
} from '../agent-runs'
import { formatDate } from '../format'
import { ErrorNotice, ReadOnlyField, SectionHeading } from './settings-fields'

const ADMIN_ONLY = 'Only an owner or admin can change this.'
const PROVIDER_OPTIONS = Object.entries(AGENT_PROVIDERS).map(
  ([value, provider]) => ({ value, label: provider.label }),
)

function isProvider(value: string | null): value is AgentProvider {
  return value !== null && value in AGENT_PROVIDERS
}

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
        <SectionHeading
          id="settings-agent-heading"
          level="h3"
          title="Model"
          description="The provider account your organisation's agent runs on."
        />
        {settings.isPending ? (
          <Skeleton className="h-10" />
        ) : settings.error ? (
          <ErrorNotice message={settings.error.message} />
        ) : canChange ? (
          <>
            <AgentModelForm
              key={[
                settings.data.model?.provider,
                settings.data.model?.modelId,
                settings.data.model?.snapshot,
                settings.data.keySetAt,
              ].join('|')}
              organisationId={organisationId}
              settings={settings.data}
            />
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

type FieldErrors = Partial<Record<'modelId' | 'snapshot' | 'key', string>>

function AgentModelForm({
  organisationId,
  settings,
}: {
  organisationId: string
  settings: OrganisationAgentSettings
}) {
  const save = useUpdateOrganisationAgentSettings(organisationId)
  const remove = useUpdateOrganisationAgentSettings(organisationId)
  const [provider, setProvider] = useState<AgentProvider>(
    settings.model?.provider ?? 'anthropic',
  )
  const [modelId, setModelId] = useState(settings.model?.modelId ?? '')
  const [snapshot, setSnapshot] = useState(settings.model?.snapshot ?? '')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const stored =
    settings.keyLastFour && settings.keySetAt
      ? { lastFour: settings.keyLastFour, setAt: settings.keySetAt }
      : null
  const busy = save.isPending || remove.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = organisationAgentSettingsUpdateSchema.safeParse({
      model: { provider, modelId, snapshot: snapshot.trim() || null },
      ...(key ? { key: { action: 'replace', value: key } } : {}),
    })
    if (!parsed.success) {
      const next: FieldErrors = {}
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] === 'key' ? 'key' : issue.path[1]
        if (field === 'modelId' || field === 'snapshot' || field === 'key')
          next[field] ??= issue.message
      }
      setErrors(next)
      return
    }
    setErrors({})
    save.mutate(parsed.data)
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <Select
        label="Provider"
        options={PROVIDER_OPTIONS}
        value={provider}
        onValueChange={(value) => {
          if (isProvider(value)) setProvider(value)
        }}
        disabled={busy}
      />
      <Input
        label="Model"
        value={modelId}
        autoComplete="off"
        spellCheck={false}
        placeholder={AGENT_PROVIDERS[provider].modelIdExample}
        error={errors.modelId}
        helperText={
          errors.modelId
            ? undefined
            : `The provider's model id, for example ${AGENT_PROVIDERS[provider].modelIdExample}.`
        }
        onChange={(event) => setModelId(event.target.value)}
      />
      <Input
        label="Snapshot (optional)"
        value={snapshot}
        autoComplete="off"
        spellCheck={false}
        error={errors.snapshot}
        helperText={
          errors.snapshot
            ? undefined
            : 'Pin a dated model version. Runs use the model id when this is blank.'
        }
        onChange={(event) => setSnapshot(event.target.value)}
      />
      {stored && !replacing ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-meta text-ink">
            {`Key ending ${stored.lastFour}, set ${formatDate(stored.setAt)}`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setReplacing(true)}
          >
            Replace key
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={remove.isPending}
            disabled={busy}
            onClick={() => remove.mutate({ key: { action: 'remove' } })}
          >
            Remove key
          </Button>
        </div>
      ) : (
        <Input
          label={stored ? 'New API key' : 'API key'}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          error={errors.key}
          helperText={
            errors.key
              ? undefined
              : `Your organisation's ${AGENT_PROVIDERS[provider].label} API key. Obiter stores it encrypted and never shows it again.`
          }
          onChange={(event) => setKey(event.target.value)}
        />
      )}
      {!settings.model || !stored ? (
        <p className="text-meta text-muted">
          Runs are refused until a model and key are set.
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" loading={save.isPending} disabled={busy}>
          Save model
        </Button>
        {replacing ? (
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setReplacing(false)
              setKey('')
            }}
          >
            Keep current key
          </Button>
        ) : null}
      </div>
      {save.error ? <ErrorNotice message={save.error.message} /> : null}
      {remove.error ? <ErrorNotice message={remove.error.message} /> : null}
    </form>
  )
}
