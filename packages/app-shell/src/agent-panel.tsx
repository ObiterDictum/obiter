import { Robot } from '@obiter/ui/icons'
import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { AgentRunView } from './agent-run-view'
import { useSessions } from './agent-sessions'
import { documentIdFromPath, matterIdFromPath } from './navigation'
import {
  MatterChip,
  DocumentChip,
  MatterTextNote,
  RunsList,
} from './agent-panel-support'
import { AgentConversation } from './views/agent-window'

export function AgentTab() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const matterId = matterIdFromPath(pathname)
  return matterId ? (
    <MatterAgent
      key={matterId}
      matterId={matterId}
      documentId={documentIdFromPath(pathname)}
    />
  ) : null
}
function MatterAgent({
  matterId,
  documentId,
}: {
  matterId: string
  documentId: string | null
}) {
  const sessions = useSessions(matterId)
  const [fresh, setFresh] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [earlier, setEarlier] = useState<string | null>(null)
  const [includeDocument, setIncludeDocument] = useState(true)
  const id = fresh ? undefined : (selected ?? sessions.data?.[0]?.id)
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setFresh(true)
            setSelected(null)
          }}
          className="text-meta text-brand"
        >
          New conversation
        </button>
        {id ? (
          <Link
            to="/agent/$sessionId"
            params={{ sessionId: id }}
            className="text-meta text-brand"
          >
            Open in full view
          </Link>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <MatterChip matterId={matterId} />
        {documentId && includeDocument ? (
          <DocumentChip
            documentId={documentId}
            onRemove={() => setIncludeDocument(false)}
          />
        ) : null}
      </div>
      {!id ? (
        <div className="mt-3 flex flex-col items-center gap-2 text-center">
          <Robot size={24} className="text-muted" aria-hidden />
          <h2 className="text-body font-medium text-ink">
            Ask about this matter
          </h2>
        </div>
      ) : null}
      <MatterTextNote
        documentAttached={Boolean(documentId && includeDocument)}
      />
      {sessions.error ? (
        <p role="alert">{sessions.error.message}</p>
      ) : sessions.isPending ? (
        <p>Loading conversations…</p>
      ) : (
        <AgentConversation
          key={id ?? 'new'}
          sessionId={id}
          matterId={matterId}
          onSent={(next) => {
            setSelected(next)
            setFresh(false)
          }}
        />
      )}
      <RunsList matterId={matterId} onSelect={setEarlier} />
      {earlier ? <AgentRunView runId={earlier} /> : null}
    </div>
  )
}
