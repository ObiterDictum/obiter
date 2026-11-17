import { expect, it } from 'bun:test'
import {
  agentModelsResponseSchema,
  agentSessionCreateRequestSchema,
  agentSessionTurnRequestSchema,
} from './index'
it('session creation and turns accept model choices and reject unknown thinking levels', () => {
  const create = {
    matterId: null,
    title: 'Research',
    mode: 'supervised',
    idempotencyKey: crypto.randomUUID(),
    model: 'claude-sonnet-5-5',
    thinking: 'high',
  }
  expect(agentSessionCreateRequestSchema.parse(create).thinking).toBe('high')
  expect(
    agentSessionCreateRequestSchema.safeParse({
      ...create,
      thinking: 'maximum',
    }).success,
  ).toBe(false)
  expect(
    agentSessionTurnRequestSchema.parse({
      kind: 'follow_up',
      text: 'Explain',
      idempotencyKey: crypto.randomUUID(),
      model: create.model,
      thinking: 'low',
    }).model,
  ).toBe(create.model)
})
it('a catalogue rejects a default thinking level the model cannot use', () => {
  expect(
    agentModelsResponseSchema.safeParse({
      models: [
        {
          id: 'model',
          provider: 'anthropic',
          label: 'Model',
          description: 'Research',
          thinkingLevels: ['low', 'high'],
          defaultThinking: 'off',
        },
      ],
      default: 'model',
      defaultThinking: 'off',
    }).success,
  ).toBe(false)
})
