import { describe, expect, it } from 'vitest'
import {
  defaultOpenRouterBenchmarkModel,
  defaultOpenRouterQaModel,
} from './models'

describe('OpenRouter model configuration', () => {
  it('pins the approved Claude model defaults', () => {
    expect(defaultOpenRouterBenchmarkModel).toBe('anthropic/claude-opus-4.8')
    expect(defaultOpenRouterQaModel).toBe('anthropic/claude-haiku-4.5')
  })
})
