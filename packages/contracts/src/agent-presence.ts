import { z } from 'zod'
import type { AgentSessionRun } from './agent-session-run'
import type { AgentSessionTraceEvent, AgentTraceEvent } from './agent-trace'

export const agentPresenceSchema = z.enum([
  'idle',
  'thinking',
  'working',
  'needs_approval',
  'done',
  'stuck',
])
export type AgentPresence = z.infer<typeof agentPresenceSchema>

type PresenceTraceEvent = AgentSessionTraceEvent | AgentTraceEvent

function toolInFlight(event: PresenceTraceEvent | null | undefined) {
  return event?.event === 'step_started' && event.kind === 'tool'
}

export function agentPresence(
  run: AgentSessionRun | null | undefined,
  latestEvent?: PresenceTraceEvent | null,
): AgentPresence {
  if (!run || run.status === 'cancelled') return 'idle'
  switch (run.status) {
    case 'queued':
    case 'running':
      return toolInFlight(latestEvent) ? 'working' : 'thinking'
    case 'waiting_for_approval':
      return 'needs_approval'
    case 'completed':
      return 'done'
    case 'failed':
    case 'refused':
      return 'stuck'
  }
}
