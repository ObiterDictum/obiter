import { queryOptions } from '@tanstack/react-query'
import type {
  AgentAvailableModel,
  AgentModelsResponse,
  AgentThinkingLevel,
} from '@obiter/contracts'
import { apiFetch } from './api'

export const agentModelsQueryOptions = queryOptions({
  queryKey: ['agent-models'],
  queryFn: () => apiFetch<AgentModelsResponse>('/api/agent/models'),
})

type ThinkingModel = Pick<
  AgentAvailableModel,
  'thinkingLevels' | 'defaultThinking'
>

const DEEPEST_FIRST = ['high', 'medium', 'low', 'off'] as const

export function shortModelLabel(label: string): string {
  return label.replace(/^Claude\s+/i, '')
}

export function thinksLonger(level: AgentThinkingLevel | undefined): boolean {
  return level === 'high'
}

export function offersThinking(
  model: Pick<AgentAvailableModel, 'thinkingLevels'>,
): boolean {
  return model.thinkingLevels.length > 1
}

export function thinkingFor(
  model: ThinkingModel,
  longer: boolean,
): AgentThinkingLevel {
  const supported = DEEPEST_FIRST.filter((level) =>
    model.thinkingLevels.includes(level),
  )
  if (longer) return supported[0] ?? 'off'
  if (model.defaultThinking !== 'high') return model.defaultThinking
  return supported.find((level) => level !== 'high') ?? 'off'
}
