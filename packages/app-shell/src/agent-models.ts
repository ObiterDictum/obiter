import { queryOptions } from '@tanstack/react-query'
import type {
  AgentAvailableModel,
  AgentModelsResponse,
  AgentThinkingLevel,
} from '@obiter/contracts'
import { apiFetch } from './api'

export const agentModelsQueryOptions = () =>
  queryOptions({
    queryKey: ['agent-models'],
    queryFn: () => apiFetch<AgentModelsResponse>('/api/agent/models'),
  })

const LEVEL_NAMES = {
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
} satisfies Record<AgentThinkingLevel, string>

export function shortModelLabel(label: string): string {
  return label.replace(/^Claude\s+/i, '')
}

export function thinkingName(level: AgentThinkingLevel): string {
  return LEVEL_NAMES[level]
}

export function thinkingPillLabel(level: AgentThinkingLevel): string {
  return level === 'off' ? 'No thinking' : LEVEL_NAMES[level]
}

export function thinkingFooterLabel(level: AgentThinkingLevel): string {
  return level === 'off' ? 'No thinking' : `${LEVEL_NAMES[level]} thinking`
}

export function offersThinking(
  model: Pick<AgentAvailableModel, 'thinkingLevels'>,
): boolean {
  return model.thinkingLevels.length > 1
}

export function thinkingForModel(
  model: Pick<AgentAvailableModel, 'thinkingLevels' | 'defaultThinking'>,
  thinking: AgentThinkingLevel,
): AgentThinkingLevel {
  return model.thinkingLevels.includes(thinking)
    ? thinking
    : model.defaultThinking
}
