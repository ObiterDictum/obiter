import { describe, expect, it } from 'bun:test'
import type { AgentAvailableModel } from '@obiter/contracts'
import {
  offersThinking,
  shortModelLabel,
  thinksLonger,
  thinkingFor,
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

describe('agent thinking mapping', () => {
  it('treats only the high level as thinking longer', () => {
    expect(thinksLonger('high')).toBe(true)
    expect(thinksLonger('medium')).toBe(false)
    expect(thinksLonger('low')).toBe(false)
    expect(thinksLonger('off')).toBe(false)
    expect(thinksLonger(undefined)).toBe(false)
  })

  it('sends high when thinking longer is on', () => {
    expect(
      thinkingFor(model(['off', 'low', 'medium', 'high'], 'medium'), true),
    ).toBe('high')
    expect(thinkingFor(model(['low', 'medium', 'high'], 'medium'), true)).toBe(
      'high',
    )
  })

  it('keeps the model default when thinking longer is off and it is not high', () => {
    expect(
      thinkingFor(model(['off', 'low', 'medium', 'high'], 'medium'), false),
    ).toBe('medium')
    expect(
      thinkingFor(model(['off', 'low', 'medium', 'high'], 'off'), false),
    ).toBe('off')
  })

  it('steps down to the next supported level when the model default is high', () => {
    expect(thinkingFor(model(['low', 'medium', 'high'], 'high'), false)).toBe(
      'medium',
    )
    expect(thinkingFor(model(['low', 'high'], 'high'), false)).toBe('low')
    expect(thinkingFor(model(['high'], 'high'), false)).toBe('off')
  })

  it('offers thinking longer only when a model has more than one level', () => {
    expect(
      offersThinking(model(['off', 'low', 'medium', 'high'], 'medium')),
    ).toBe(true)
    expect(offersThinking(model(['high'], 'high'))).toBe(false)
  })

  it('drops the Claude prefix so the pill fits', () => {
    expect(shortModelLabel('Claude Sonnet 5.5')).toBe('Sonnet 5.5')
    expect(shortModelLabel('Test model')).toBe('Test model')
  })
})
