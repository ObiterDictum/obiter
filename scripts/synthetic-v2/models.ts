export const defaultOpenRouterBenchmarkModel = 'anthropic/claude-opus-4.8'
export const defaultOpenRouterQaModel = 'anthropic/claude-haiku-4.5'

export function openRouterBenchmarkModel() {
  return (
    process.env.OPENROUTER_BENCHMARK_MODEL ?? defaultOpenRouterBenchmarkModel
  )
}

export function openRouterQaModel() {
  return process.env.OPENROUTER_QA_MODEL ?? defaultOpenRouterQaModel
}
