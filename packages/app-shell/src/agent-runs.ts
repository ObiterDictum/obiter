import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useEffect } from 'react'
import {
  agentRunStreamMessageSchema,
  isAgentRunLive,
  type AgentRun,
  type AgentRunCreateRequest,
  type AgentRunDetailResponse,
  type AgentRunListResponse,
  type AgentRunResponse,
  type AgentRunStreamMessage,
  type OrganisationAgentSettings,
  type OrganisationAgentSettingsUpdate,
} from '@obiter/contracts'
import { apiFetch, apiFetchEventStream } from './api'

export const agentRunKeys = {
  all: ['agent-runs'] as const,
  forMatter: (matterId: string) =>
    [...agentRunKeys.all, 'matter', matterId] as const,
  detail: (runId: string) => [...agentRunKeys.all, 'run', runId] as const,
  settings: (organisationId: string) =>
    [...agentRunKeys.all, 'settings', organisationId] as const,
}

export function matterAgentRunsQueryOptions(matterId: string) {
  return queryOptions({
    queryKey: agentRunKeys.forMatter(matterId),
    queryFn: async () =>
      (
        await apiFetch<AgentRunListResponse>(
          `/api/matters/${matterId}/agent-runs`,
        )
      ).runs,
  })
}

export function agentRunQueryOptions(runId: string) {
  return queryOptions({
    queryKey: agentRunKeys.detail(runId),
    queryFn: () => apiFetch<AgentRunDetailResponse>(`/api/agent-runs/${runId}`),
    refetchInterval: (query) => {
      const run = query.state.data?.run
      return run && isAgentRunLive(run) ? 5000 : false
    },
  })
}

export function useMatterAgentRuns(matterId: string) {
  return useQuery(matterAgentRunsQueryOptions(matterId))
}

export function useAgentRun(runId: string) {
  return useQuery(agentRunQueryOptions(runId))
}

function storeRun(queryClient: QueryClient, run: AgentRun) {
  queryClient.setQueryData<AgentRunDetailResponse>(
    agentRunKeys.detail(run.id),
    (previous) => (previous ? { ...previous, run } : previous),
  )
  queryClient.setQueryData<AgentRun[]>(
    agentRunKeys.forMatter(run.matterId),
    (previous) =>
      previous
        ? [run, ...previous.filter((item) => item.id !== run.id)]
        : previous,
  )
}

export function applyAgentStreamMessage(
  previous: AgentRunDetailResponse,
  message: AgentRunStreamMessage,
): AgentRunDetailResponse {
  if (message.type === 'run') return { ...previous, run: message.run }
  const lastSeq = previous.events.at(-1)?.seq ?? 0
  if (message.event.seq <= lastSeq) return previous
  return { ...previous, events: [...previous.events, message.event] }
}

export function useCreateAgentRun(matterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: AgentRunCreateRequest) =>
      (
        await apiFetch<AgentRunResponse>(
          `/api/matters/${matterId}/agent-runs`,
          { method: 'POST', body: JSON.stringify(input) },
        )
      ).run,
    onSuccess: (run) => {
      queryClient.setQueryData<AgentRunDetailResponse>(
        agentRunKeys.detail(run.id),
        (previous) => previous ?? { run, steps: [], toolCalls: [], events: [] },
      )
      storeRun(queryClient, run)
      void queryClient.invalidateQueries({
        queryKey: agentRunKeys.forMatter(matterId),
      })
    },
  })
}

export function useCancelAgentRun() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (runId: string) =>
      (
        await apiFetch<AgentRunResponse>(`/api/agent-runs/${runId}/cancel`, {
          method: 'POST',
        })
      ).run,
    onSuccess: (run) => storeRun(queryClient, run),
  })
}

export function parseEventStreamChunk(buffer: string) {
  const blocks = buffer.replaceAll('\r\n', '\n').split('\n\n')
  const rest = blocks.pop() ?? ''
  const messages: AgentRunStreamMessage[] = []
  for (const block of blocks) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    const parsed = agentRunStreamMessageSchema.safeParse(JSON.parse(data))
    if (!parsed.success) {
      throw new Error('The agent run stream sent an unrecognised message.')
    }
    messages.push(parsed.data)
  }
  return { messages, rest }
}

async function readRunStream(
  runId: string,
  after: number,
  signal: AbortSignal,
  onMessage: (message: AgentRunStreamMessage) => void,
) {
  const response = await apiFetchEventStream(
    `/api/agent-runs/${runId}/events?after=${after}`,
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
    chunk.messages.forEach(onMessage)
  }
}

export function useAgentRunStream(run: AgentRun | undefined) {
  const queryClient = useQueryClient()
  const runId = run?.id
  const live = run ? isAgentRunLive(run) : false

  useEffect(() => {
    if (!runId || !live) return
    const controller = new AbortController()
    const after =
      queryClient
        .getQueryData<AgentRunDetailResponse>(agentRunKeys.detail(runId))
        ?.events.at(-1)?.seq ?? 0
    readRunStream(runId, after, controller.signal, (message) => {
      queryClient.setQueryData<AgentRunDetailResponse>(
        agentRunKeys.detail(runId),
        (previous) =>
          previous ? applyAgentStreamMessage(previous, message) : previous,
      )
      if (message.type === 'run') storeRun(queryClient, message.run)
    })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.warn('agent_run_stream_closed', {
          runId,
          reason: error instanceof Error ? error.message : 'unknown',
        })
      })
      .finally(() => {
        if (controller.signal.aborted) return
        void queryClient.invalidateQueries({
          queryKey: agentRunKeys.detail(runId),
        })
      })
    return () => controller.abort()
  }, [runId, live, queryClient])
}

export function organisationAgentSettingsQueryOptions(organisationId: string) {
  return queryOptions({
    queryKey: agentRunKeys.settings(organisationId),
    queryFn: () =>
      apiFetch<OrganisationAgentSettings>(
        `/api/organisations/${organisationId}/agent-settings`,
      ),
  })
}

export function useOrganisationAgentSettings(organisationId: string | null) {
  return useQuery({
    ...organisationAgentSettingsQueryOptions(organisationId ?? ''),
    enabled: organisationId !== null,
  })
}

export function useUpdateOrganisationAgentSettings(organisationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OrganisationAgentSettingsUpdate) =>
      apiFetch<OrganisationAgentSettings>(
        `/api/organisations/${organisationId}/agent-settings`,
        { method: 'PUT', body: JSON.stringify(input) },
      ),
    onSuccess: (settings) =>
      queryClient.setQueryData(agentRunKeys.settings(organisationId), settings),
  })
}
