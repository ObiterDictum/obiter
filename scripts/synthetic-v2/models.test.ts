import { describe, expect, it } from 'vitest'
import {
  defaultOpenRouterBenchmarkModel,
  defaultOpenRouterQaModel,
} from './models'

describe('OpenRouter model configuration', () => {
  it('pins the approved generation and annotation model defaults', () => {
    expect(defaultOpenRouterBenchmarkModel).toBe('anthropic/claude-opus-4.8')
    expect(defaultOpenRouterQaModel).toBe('google/gemini-3.6-flash')
  })
})
