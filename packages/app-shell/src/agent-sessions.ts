import { queryOptions, useQuery } from '@tanstack/react-query'
import type {
  AgentSessionListResponse,
  AgentSessionDetailResponse,
  AgentSessionResponse,
  AgentSessionTurnResponse,
} from '@obiter/contracts'
import { apiFetch } from './api'

export const sessionKeys = {
  lists: ['agent-sessions', 'list'],
  detail: (id: string) => ['agent-sessions', 'detail', id],
}
export function sessionsQueryOptions(matterId: string | null) {
  return queryOptions({
    queryKey: [...sessionKeys.lists, matterId],
    queryFn: () =>
      apiFetch<AgentSessionListResponse>(
        `/api/agent-sessions${matterId ? `?matterId=${encodeURIComponent(matterId)}` : ''}`,
      ),
    select: (data) =>
      [...data.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  })
}
export function sessionQueryOptions(id: string) {
  return queryOptions({
    queryKey: sessionKeys.detail(id),
    queryFn: () =>
      apiFetch<AgentSessionDetailResponse>(
        `/api/agent-sessions/${encodeURIComponent(id)}`,
      ),
    refetchInterval: (query) =>
      query.state.data?.session.activeRunId ? 2000 : false,
    retry: false,
  })
}
export function useSessions(matterId: string | null) {
  return useQuery(sessionsQueryOptions(matterId))
}
export function conversationTitle(text: string) {
  const title = text.trim()
  if (title.length <= 80) return title
  const prefix = title.slice(0, 80)
  const boundary = prefix.lastIndexOf(' ')
  return boundary > 0 ? prefix.slice(0, boundary) : prefix
}
export async function createSession(
  matterId: string | null,
  text: string,
  idempotencyKey: string,
) {
  return (
    await apiFetch<AgentSessionResponse>('/api/agent-sessions', {
      method: 'POST',
      body: JSON.stringify({
        matterId,
        title: conversationTitle(text),
        mode: 'supervised',
        idempotencyKey,
      }),
    })
  ).session
}
export function postTurn(id: string, text: string, idempotencyKey: string) {
  return apiFetch<AgentSessionTurnResponse>(
    `/api/agent-sessions/${encodeURIComponent(id)}/turns`,
    {
      method: 'POST',
      body: JSON.stringify({ kind: 'follow_up', text, idempotencyKey }),
    },
  )
}
