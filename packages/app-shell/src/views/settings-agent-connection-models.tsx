import { useState, type Dispatch, type SetStateAction } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  AgentConnectionModel,
  AgentConnectionTestResponse,
} from '@obiter/contracts'
import {
  AGENT_CONNECTION_ENABLED_MODEL_LIMIT,
  AGENT_CONNECTION_LISTED_MODEL_LIMIT,
} from '@obiter/contracts/limits'
import { Button, Input } from '@obiter/ui'
import { apiFetch } from '../api'
import { ErrorNotice } from './settings-fields'

export const connectionModelsKey = (id: string) => [
  'agent-connection-models',
  id,
]
export function ConnectionModels({
  connectionId,
  enabled,
  setEnabled,
}: {
  connectionId: string
  enabled: string[] | null
  setEnabled: Dispatch<SetStateAction<string[] | null>>
}) {
  const test = `/api/agent/connections/${connectionId}/test`
  const listing = useQuery({
    queryKey: connectionModelsKey(connectionId),
    queryFn: () =>
      apiFetch<AgentConnectionTestResponse>(test, {
        method: 'POST',
        body: '{}',
      }),
    retry: false,
    staleTime: Infinity,
  })
  const listed = listing.data?.models
  const listedIds = listed?.map((model) => model.id) ?? []
  const effective = enabled ?? listedIds
  const rows: AgentConnectionModel[] = [
    ...(listed ?? []),
    ...effective
      .filter((id) => !listedIds.includes(id))
      .map((id) => ({ id, name: null })),
  ]
  const [filter, setFilter] = useState('')
  const needle = filter.trim().toLowerCase()
  const shown = rows.filter((model) =>
    `${model.id} ${model.name ?? ''}`.toLowerCase().includes(needle),
  )
  const [manual, setManual] = useState('')
  const probe = useMutation({
    mutationFn: (modelId: string) =>
      apiFetch<AgentConnectionTestResponse>(test, {
        method: 'POST',
        body: JSON.stringify({ modelId }),
      }),
    onSuccess: (_data, modelId) => {
      setEnabled((current) => [
        ...new Set([...(current ?? listedIds), modelId]),
      ])
      setManual('')
    },
  })
  const unlisted = listing.isError || (listing.isSuccess && !listed)
  function toggle(id: string, on: boolean) {
    setEnabled((current) => {
      const base = current ?? listedIds
      return on ? [...base, id] : base.filter((item) => item !== id)
    })
  }
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-item text-ink">Models</legend>
      <p className="text-caption text-muted">
        People in your organisation can choose any model turned on here.
      </p>
      {listing.isPending ? (
        <p role="status" className="text-body text-muted">
          Asking the provider for its models…
        </p>
      ) : null}
      {listing.error ? <ErrorNotice message={listing.error.message} /> : null}
      {listed && listed.length > 10 ? (
        <Input
          label="Filter models"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      {rows.length ? (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
          {shown.map((model) => (
            <label
              key={model.id}
              className="flex items-start gap-3 rounded px-1 py-1 text-meta text-ink hover:bg-hover"
            >
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-brand"
                aria-label={
                  model.name ? `${model.name} (${model.id})` : model.id
                }
                checked={effective.includes(model.id)}
                onChange={(event) => toggle(model.id, event.target.checked)}
              />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{model.name ?? model.id}</span>
                {model.name && model.name !== model.id ? (
                  <span className="truncate text-caption text-muted">
                    {model.id}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
          {shown.length ? null : (
            <p className="text-caption text-muted">No models match.</p>
          )}
        </div>
      ) : null}
      {rows.length ? (
        <p role="status" className="text-caption text-muted">
          {effective.length} of {rows.length} turned on.
          {listing.data?.truncated
            ? ` The provider listed more than ${AGENT_CONNECTION_LISTED_MODEL_LIMIT}; only the first ${AGENT_CONNECTION_LISTED_MODEL_LIMIT} are shown.`
            : ''}
        </p>
      ) : null}
      {effective.length > AGENT_CONNECTION_ENABLED_MODEL_LIMIT ? (
        <ErrorNotice
          message={`Turn on at most ${AGENT_CONNECTION_ENABLED_MODEL_LIMIT} models.`}
        />
      ) : null}
      {unlisted ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted">
            {listing.isError
              ? 'Add a model ID exactly as the provider writes it.'
              : "This provider didn't list its models. Add a model ID exactly as the provider writes it."}{' '}
            Obiter sends it a short test request first.
          </p>
          <div className="flex items-end gap-2">
            <Input
              label="Model ID"
              value={manual}
              maxLength={128}
              onChange={(event) => setManual(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={!manual.trim() || probe.isPending}
              onClick={() => probe.mutate(manual.trim())}
            >
              {probe.isPending ? 'Testing…' : 'Test and add'}
            </Button>
          </div>
          {probe.error ? <ErrorNotice message={probe.error.message} /> : null}
        </div>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={listing.isFetching}
        onClick={() => void listing.refetch()}
      >
        {listing.isFetching ? 'Loading models…' : 'Load models'}
      </Button>
    </fieldset>
  )
}
