import type {
  AgentRun,
  AgentStopReason,
  AgentToolId,
  AgentTraceEvent,
} from '@obiter/contracts'

export type AgentTimelineStatus = 'running' | 'done' | 'error' | 'refused'

export interface AgentTimelineRow {
  step: number
  label: string
  status: AgentTimelineStatus
}

const TOOL_LABELS = {
  search_corpus: 'Searched the law',
  get_paragraph: 'Read a paragraph',
  matter_documents: "Listed the matter's documents",
  read_document_version: 'Read a document',
} satisfies Record<AgentToolId, string>

export function agentToolLabel(tool: AgentToolId): string {
  return TOOL_LABELS[tool]
}

export function agentTimelineRows(
  events: readonly AgentTraceEvent[],
): AgentTimelineRow[] {
  const rows = new Map<number, AgentTimelineRow>()
  const extra: AgentTimelineRow[] = []
  for (const event of events) {
    switch (event.event) {
      case 'step_started':
        rows.set(event.step, {
          step: event.step,
          label: event.tool
            ? agentToolLabel(event.tool)
            : 'Worked out the next step',
          status: 'running',
        })
        break
      case 'tool_called':
      case 'model_called': {
        const row = rows.get(event.step)
        const failed =
          event.event === 'tool_called'
            ? event.status === 'error'
            : event.finish === 'error'
        if (row) row.status = failed ? 'error' : 'done'
        break
      }
      case 'tool_refused':
        rows.set(event.step, {
          step: event.step,
          label: 'Refused a request the run is not allowed to make',
          status: 'refused',
        })
        break
      case 'model_refused':
        rows.set(event.step, {
          step: event.step,
          label: 'Stopped before a call that would exceed the budget',
          status: 'refused',
        })
        break
      case 'claim_dropped':
        extra.push({
          step: event.step,
          label:
            event.reason === 'no_evidence'
              ? 'Dropped a sentence with no source'
              : 'Cited a source it had not read',
          status: event.reason === 'no_evidence' ? 'done' : 'error',
        })
        break
      case 'run_started':
      case 'validation_failed':
      case 'claim_written':
      case 'stop':
        break
    }
  }
  return [...rows.values(), ...extra].sort((a, b) => a.step - b.step)
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
}

export function agentRunSummary(run: AgentRun): string {
  const sources = `read ${run.sourcesRead} ${run.sourcesRead === 1 ? 'source' : 'sources'}`
  if (!run.startedAt) return 'Waiting to start'
  if (!run.finishedAt) return `Working · ${sources}`
  const elapsed = formatDuration(
    Date.parse(run.finishedAt) - Date.parse(run.startedAt),
  )
  return `Worked for ${elapsed} · ${sources}`
}

const STOP_REASON_LABELS = {
  completed: 'Answered',
  user_cancelled: 'Cancelled',
  weak_evidence: 'Stopped: the answer was not supported by its sources',
  model_unavailable: 'Stopped: the model provider was unavailable',
  system_error: 'Stopped: the run failed',
  policy_blocked: 'Refused: not permitted',
  permission_denied: 'Refused: you do not have access',
  missing_context: 'Refused: something it needs is missing',
  over_budget: 'Refused: the run budget was reached',
} satisfies Record<AgentStopReason, string>

export function agentStopReasonLabel(reason: AgentStopReason): string {
  return STOP_REASON_LABELS[reason]
}

export function agentRunStatusLabel(run: AgentRun): string {
  switch (run.status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Working'
    case 'waiting_for_approval':
      return 'Waiting for approval'
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'refused':
      return agentStopReasonLabel(run.stopReason)
  }
}
