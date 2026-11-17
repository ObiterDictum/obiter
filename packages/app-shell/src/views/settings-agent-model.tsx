import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AGENT_PROVIDERS,
  organisationAgentSettingsUpdateSchema,
  type AgentProvider,
  type OrganisationAgentSettings,
  type AgentThinkingLevel,
} from '@obiter/contracts'
import { Button, Input, Select } from '@obiter/ui'
import {
  agentModelsQueryOptions,
  offersThinking,
  thinkingForModel,
} from '../agent-models'
import { useUpdateOrganisationAgentSettings } from '../agent-runs'
import { formatDate } from '../format'
import { ErrorNotice } from './settings-fields'
import { ThinkingChoice } from './agent-thinking-choice'
const PROVIDER_OPTIONS = Object.entries(AGENT_PROVIDERS).map(
  ([value, provider]) => ({ value, label: provider.label }),
)
function isProvider(value: string | null): value is AgentProvider {
  return value !== null && value in AGENT_PROVIDERS
}
type FieldErrors = Partial<Record<'modelId' | 'snapshot' | 'key', string>>

export function AgentModelForm({
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
  const catalogue = useQuery(agentModelsQueryOptions())
  const [thinking, setThinking] = useState<AgentThinkingLevel>(
    settings.thinking ?? 'off',
  )
  const [modelId, setModelId] = useState(settings.model?.modelId ?? '')
  const [snapshot, setSnapshot] = useState(settings.model?.snapshot ?? '')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const selectedModel = catalogue.data?.models?.find(
    (model) => model.id === modelId,
  )
  const stored =
    settings.keyLastFour && settings.keySetAt
      ? { lastFour: settings.keyLastFour, setAt: settings.keySetAt }
      : null
  const busy = save.isPending || remove.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    const parsed = organisationAgentSettingsUpdateSchema.safeParse({
      thinking,
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
      {catalogue.data?.models?.length ? (
        <Select
          label="Suggested model"
          value={modelId}
          options={catalogue.data.models.map((model) => ({
            value: model.id,
            label: model.label,
          }))}
          onValueChange={(value) => {
            const model = catalogue.data.models.find(
              (model) => model.id === value,
            )
            if (model) {
              setModelId(model.id)
              setSnapshot('')
              setThinking(thinkingForModel(model, thinking))
            }
          }}
          disabled={busy}
        />
      ) : null}
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
        onChange={(event) => {
          const value = event.target.value
          setModelId(value)
          const model = catalogue.data?.models?.find(
            (item) => item.id === value,
          )
          setThinking(model ? thinkingForModel(model, thinking) : 'off')
        }}
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
      {selectedModel && offersThinking(selectedModel) ? (
        <div className="flex items-center gap-3">
          <span className="text-meta text-ink">Default thinking</span>
          <ThinkingChoice
            label="Default thinking"
            className="ml-auto"
            levels={selectedModel.thinkingLevels}
            value={thinkingForModel(selectedModel, thinking)}
            disabled={busy}
            onChange={setThinking}
          />
        </div>
      ) : null}
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
