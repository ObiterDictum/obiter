import { queryOptions } from '@tanstack/react-query'
import type { AgentModelsResponse } from '@obiter/contracts'
import { apiFetch } from './api'

export const agentModelsQueryOptions = queryOptions({
  queryKey: ['agent-models'],
  queryFn: () => apiFetch<AgentModelsResponse>('/api/agent/models'),
})
