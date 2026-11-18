import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentConnection, AgentConnectionSaved } from '@obiter/contracts'
import { AGENT_CONNECTION_ENABLED_MODEL_LIMIT } from '@obiter/contracts/limits'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
  Input,
  Switch,
} from '@obiter/ui'
import { apiFetch } from '../api'
import { ErrorNotice, SectionHeading } from './settings-fields'
import {
  ConnectionModels,
  connectionModelsKey,
} from './settings-agent-connection-models'

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
          className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="text-item text-ink">{connection.name}</div>
            <div className="text-caption text-muted">
              {new URL(connection.baseUrl).host} · Key ending{' '}
              {connection.keyLastFour} ·{' '}
              {`${connection.modelCount ?? connection.modelIds.length} ${(connection.modelCount ?? connection.modelIds.length) === 1 ? 'model' : 'models'}`}
            </div>
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
            <Dialog>
              <DialogTrigger
                render={<Button variant="secondary">Remove</Button>}
              />
              <DialogContent size="sm">
                <DialogTitle>Remove {connection.name}?</DialogTitle>
                <DialogDescription>
                  Agent chats using models from this connection will stop
                  working until you choose another model.
                </DialogDescription>
                <DialogFooter>
                  <DialogClose
                    render={<Button variant="ghost">Cancel</Button>}
                  />
                  <DialogClose
                    render={
                      <Button
                        variant="danger"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ id: connection.id, test: false })
                        }
                      >
                        Remove connection
                      </Button>
                    }
                  />
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
            onSaved={async (close) => {
              if (close) setEditing(null)
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
  onSaved: (close: boolean) => Promise<void>
}) {
  const client = useQueryClient()
  const [id, setId] = useState(connection?.id ?? null)
  const [name, setName] = useState(connection?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '')
  const [key, setKey] = useState('')
  const [enabled, setEnabled] = useState<string[] | null>(
    connection?.modelIds.length ? connection.modelIds : null,
  )
  const [reasoning, setReasoning] = useState(
    connection?.supportsReasoningEffort ?? true,
  )
  const save = useMutation({
    mutationFn: () =>
      apiFetch<AgentConnectionSaved>(`${path}${id ? `/${id}` : ''}`, {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name,
          baseUrl,
          supportsReasoningEffort: reasoning,
          ...(id ? (enabled ? { modelIds: enabled } : {}) : { modelIds: [] }),
          ...(key ? { key } : {}),
        }),
      }),
    onSuccess: async (saved) => {
      if (id)
        await client.invalidateQueries({ queryKey: connectionModelsKey(id) })
      if (!id && saved.id) {
        setId(saved.id)
        setKey('')
        await onSaved(false)
        return
      }
      await onSaved(true)
    },
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  const tooMany =
    enabled !== null && enabled.length > AGENT_CONNECTION_ENABLED_MODEL_LIMIT
  const noneOn = enabled !== null && enabled.length === 0
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
          label={id ? 'Replace API key (optional)' : 'API key'}
          value={key}
          onChange={(event) => setKey(event.target.value)}
          required={!id}
          type="password"
          autoComplete="off"
        />
        <Switch
          label="Supports reasoning effort"
          checked={reasoning}
          onCheckedChange={setReasoning}
        >
          Supports reasoning effort
        </Switch>
        {id ? (
          <ConnectionModels
            connectionId={id}
            enabled={enabled}
            setEnabled={setEnabled}
          />
        ) : null}
        {noneOn ? <ErrorNotice message="Turn on at least one model." /> : null}
        {save.error ? <ErrorNotice message={save.error.message} /> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button type="submit" disabled={save.isPending || tooMany || noneOn}>
            {save.isPending
              ? 'Saving…'
              : id
                ? 'Save connection'
                : 'Save and load models'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
