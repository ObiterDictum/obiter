import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentConnection } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Input,
  Switch,
} from '@obiter/ui'
import { apiFetch } from '../api'
import { ErrorNotice, SectionHeading } from './settings-fields'

const path = '/api/agent/connections'
export function AgentConnections({
  organisationId,
}: {
  organisationId: string
}) {
  const client = useQueryClient()
  const queryKey = ['agent-connections', organisationId]
  const connections = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ connections: AgentConnection[] }>(path),
  })
  const [editing, setEditing] = useState<AgentConnection | 'new' | null>(null)
  const [result, setResult] = useState('')
  const action = useMutation({
    mutationFn: ({ id, test }: { id: string; test: boolean }) =>
      apiFetch<{ message?: string }>(`${path}/${id}${test ? '/test' : ''}`, {
        method: test ? 'POST' : 'DELETE',
      }),
    onSuccess: async (data) => {
      setResult(data.message ?? 'Connection removed.')
      await client.invalidateQueries({ queryKey })
      await client.invalidateQueries({ queryKey: ['agent-models'] })
    },
  })
  return (
    <div className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeading
        id="agent-connections-heading"
        level="h3"
        title="Connections"
        description="Connect an OpenAI-compatible provider alongside Anthropic. Managed models are still to come."
      />
      {connections.error ? (
        <ErrorNotice message={connections.error.message} />
      ) : null}
      {connections.data?.connections.map((connection) => (
        <div
          key={connection.id}
          className="flex flex-col gap-2 border-b border-line pb-4"
        >
          <div className="text-item text-ink">{connection.name}</div>
          <div className="text-caption text-muted">
            {new URL(connection.baseUrl).host} · Key ending{' '}
            {connection.keyLastFour} ·{' '}
            {`${connection.modelCount ?? connection.modelIds.length} ${(connection.modelCount ?? connection.modelIds.length) === 1 ? 'model' : 'models'}`}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setEditing(connection)}>
              Edit
            </Button>
            <Button
              variant="secondary"
              disabled={action.isPending}
              onClick={() => action.mutate({ id: connection.id, test: true })}
            >
              Test
            </Button>
            <Button
              variant="secondary"
              disabled={action.isPending}
              onClick={() => action.mutate({ id: connection.id, test: false })}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      {result ? (
        <p role="status" className="text-body text-ink">
          {result}
        </p>
      ) : null}
      {action.error ? <ErrorNotice message={action.error.message} /> : null}
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => setEditing('new')}
      >
        Add connection
      </Button>
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      >
        {editing ? (
          <ConnectionForm
            key={editing === 'new' ? 'new' : editing.id}
            connection={editing === 'new' ? null : editing}
            onSaved={async () => {
              setEditing(null)
              await client.invalidateQueries({ queryKey })
              await client.invalidateQueries({ queryKey: ['agent-models'] })
            }}
          />
        ) : null}
      </Dialog>
    </div>
  )
}
function ConnectionForm({
  connection,
  onSaved,
}: {
  connection: AgentConnection | null
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(connection?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [models, setModels] = useState(connection?.modelIds.join(', ') ?? '')
  const [reasoning, setReasoning] = useState(
    connection?.supportsReasoningEffort ?? true,
  )
  const save = useMutation({
    mutationFn: () =>
      apiFetch(`${path}${connection ? `/${connection.id}` : ''}`, {
        method: connection ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name,
          baseUrl,
          modelIds: models
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          supportsReasoningEffort: reasoning,
          ...(key ? { key } : {}),
        }),
      }),
    onSuccess: onSaved,
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  return (
    <DialogContent>
      <DialogTitle>
        {connection ? 'Edit connection' : 'Add connection'}
      </DialogTitle>
      <DialogDescription>
        Obiter can't check what this provider keeps. Only connect providers with
        zero data retention if matter documents may be sent.
      </DialogDescription>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Connection name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={80}
        />
        <Input
          label="Base URL"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          required
          type="url"
          placeholder="https://provider.example/v1"
        />
        <Input
          label={connection ? 'Replace API key (optional)' : 'API key'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          required={!connection}
          type="password"
          autoComplete="off"
        />
        <Input
          label="Model ids (comma separated, optional)"
          value={models}
          onChange={(event) => setModels(event.target.value)}
        />
        <Switch
          label="Supports reasoning effort"
          checked={reasoning}
          onCheckedChange={setReasoning}
        >
          Supports reasoning effort
        </Switch>
        {save.error ? <ErrorNotice message={save.error.message} /> : null}
        <DialogFooter>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save connection'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
