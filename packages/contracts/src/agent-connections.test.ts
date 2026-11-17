import { expect, test } from 'bun:test'
import {
  agentConnectionCreateSchema,
  agentConnectionSchema,
  agentConnectionUpdateSchema,
} from './agent-connections'
const input = {
  name: 'Gateway',
  baseUrl: 'https://gateway.example/v1',
  modelIds: [],
  supportsReasoningEffort: true,
  key: 'synthetic-secret-value',
}
test('connection creation requires a key and accepts automatic model discovery', () => {
  expect(agentConnectionCreateSchema.safeParse(input).success).toBe(true)
  expect(
    agentConnectionCreateSchema.safeParse({ ...input, key: undefined }).success,
  ).toBe(false)
})
test('connection edits preserve an existing key and reject empty updates', () => {
  expect(
    agentConnectionUpdateSchema.safeParse({ name: 'Renamed' }).success,
  ).toBe(true)
  expect(agentConnectionUpdateSchema.safeParse({}).success).toBe(false)
})
test('connection responses reject secrets', () => {
  const response = { ...input, id: crypto.randomUUID(), keyLastFour: 'alue' }
  expect(agentConnectionSchema.safeParse(response).success).toBe(false)
  const { key, ...safe } = response
  expect(key).toBe('synthetic-secret-value')
  expect(agentConnectionSchema.safeParse(safe).success).toBe(true)
})
