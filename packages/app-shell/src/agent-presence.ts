import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  agentPresence,
  type AgentSessionRun,
  type AgentTraceEvent,
} from '@obiter/contracts'
import { apiFetchEventStream } from './api'
import { parseEventStreamChunk } from './agent-runs'
import { sessionQueryOptions } from './agent-sessions'

async function readLatestEvents(
  runId: string,
  signal: AbortSignal,
  onEvent: (event: AgentTraceEvent) => void,
) {
  const response = await apiFetchEventStream(
    `/api/agent-runs/${encodeURIComponent(runId)}/events`,
    { signal },
  )
  if (!response.body) return
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    const chunk = parseEventStreamChunk(buffer + value)
    buffer = chunk.rest
    for (const message of chunk.messages)
      if (message.type === 'event') onEvent(message.event)
  }
}

export function useRunPresence(run: AgentSessionRun | undefined, live = true) {
  const [latest, setLatest] = useState<{
    runId: string
    event: AgentTraceEvent
  } | null>(null)
  const runId = run?.id
  const streaming =
    live && (run?.status === 'queued' || run?.status === 'running')
  useEffect(() => {
    if (!runId || !streaming) return
    const controller = new AbortController()
    readLatestEvents(runId, controller.signal, (event) =>
      setLatest({ runId, event }),
    ).catch((error: unknown) => {
      if (controller.signal.aborted) return
      console.warn('agent_run_stream_closed', {
        runId,
        reason: error instanceof Error ? error.message : 'unknown',
      })
    })
    return () => controller.abort()
  }, [runId, streaming])
  return agentPresence(
    run,
    latest && latest.runId === runId ? latest.event : null,
  )
}

export function useSessionPresence(sessionId: string | undefined) {
  const detail = useQuery({
    ...sessionQueryOptions(sessionId ?? ''),
    enabled: Boolean(sessionId),
  })
  return useRunPresence(detail.data?.runs.at(-1))
}
