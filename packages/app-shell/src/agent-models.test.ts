import { describe, expect, it } from 'bun:test'
import type { AgentAvailableModel } from '@obiter/contracts'
import {
  offersThinking,
  shortModelLabel,
  thinkingFooterLabel,
  thinkingForModel,
  thinkingName,
  thinkingPillLabel,
} from './agent-models'

const model = (
  thinkingLevels: AgentAvailableModel['thinkingLevels'],
  defaultThinking: AgentAvailableModel['defaultThinking'],
): AgentAvailableModel => ({
  id: 'claude-sonnet-5-5',
  provider: 'anthropic',
  label: 'Claude Sonnet 5.5',
  description: 'Balanced speed and depth for everyday research',
  thinkingLevels,
  defaultThinking,
})

describe('agent thinking labels', () => {
  it('names each level for the segmented control', () => {
    expect(
      (['off', 'low', 'medium', 'high'] as const).map(thinkingName),
    ).toEqual(['Off', 'Low', 'Medium', 'High'])
  })

  it('reads no thinking as words in the pill and the footer', () => {
    expect(thinkingPillLabel('off')).toBe('No thinking')
    expect(thinkingFooterLabel('off')).toBe('No thinking')
  })

  it('keeps the pill to the level name and the footer to the full phrase', () => {
    expect(thinkingPillLabel('medium')).toBe('Medium')
    expect(thinkingFooterLabel('medium')).toBe('Medium thinking')
    expect(thinkingFooterLabel('high')).toBe('High thinking')
  })
})

describe('agent thinking choice', () => {
  it('keeps the level when the new model supports it', () => {
    expect(
      thinkingForModel(
        model(['off', 'low', 'medium', 'high'], 'medium'),
        'high',
      ),
    ).toBe('high')
    expect(
      thinkingForModel(model(['low', 'medium', 'high'], 'medium'), 'low'),
    ).toBe('low')
  })

  it('falls back to the model default when the level is unsupported', () => {
    expect(
      thinkingForModel(model(['low', 'medium', 'high'], 'medium'), 'off'),
    ).toBe('medium')
  })

  it('offers a thinking choice only when a model has more than one level', () => {
    expect(
      offersThinking(model(['off', 'low', 'medium', 'high'], 'medium')),
    ).toBe(true)
    expect(offersThinking(model(['off'], 'off'))).toBe(false)
  })

  it('drops the Claude prefix so the pill fits', () => {
    expect(shortModelLabel('Claude Sonnet 5.5')).toBe('Sonnet 5.5')
    expect(shortModelLabel('Test model')).toBe('Test model')
  })
})
