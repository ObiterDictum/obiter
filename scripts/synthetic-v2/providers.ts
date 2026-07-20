import { parseAnnotationResponse } from './annotations'
import {
  draftSystemPrompt,
  draftUserPrompt,
  labelSystemPrompt,
  labelUserPrompt,
} from './prompts'
import { judgePrompt } from './qa'
import type {
  DocumentSpec,
  GeneratedAnnotation,
  GeneratedDocument,
  GenerationProgress,
  GeneratorAdapter,
  JudgeAdapter,
  LabelingAdapter,
  LabelInput,
  RequestTelemetry,
  SyntheticDocument,
  Usage,
} from './types'

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigurationError'
  }
}
class ProviderHttpError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} request failed with HTTP ${status}`)
    this.name = 'ProviderHttpError'
  }
}
export class ProviderBatchError extends Error {
  constructor(
    message: string,
    readonly telemetry: RequestTelemetry[],
  ) {
    super(message)
    this.name = 'ProviderBatchError'
  }
}

type Fetcher = typeof fetch
type Options = {
  baseUrl?: string
  concurrency?: number
  timeoutMs?: number
  fetch?: Fetcher
}

function requiredEnvironment(name: string) {
  const value = process.env[name]
  if (!value)
    throw new ProviderConfigurationError(
      `${name} is required through the process environment`,
    )
  return value
}

const annotationSchema = {
  name: 'synthetic_v2_annotation',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'spans'],
    properties: {
      id: { type: 'string' },
      spans: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'quote', 'occurrence'],
          properties: {
            category: { type: 'string' },
            quote: { type: 'string' },
            occurrence: { type: 'integer', minimum: 1 },
            start: { type: 'integer', minimum: 0 },
            end: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
  },
} as const
const judgeSchema = {
  name: 'synthetic_v2_judge',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'allProposedSpansCorrect',
      'hardNegativesCorrect',
      'obviousUnmarkedSpans',
      'realismScore',
      'confidence',
      'rationale',
    ],
    properties: {
      id: { type: 'string' },
      allProposedSpansCorrect: { type: 'boolean' },
      hardNegativesCorrect: { type: 'boolean' },
      obviousUnmarkedSpans: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'text'],
          properties: {
            category: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      realismScore: { type: 'integer', minimum: 1, maximum: 5 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string' },
    },
  },
} as const

export class OpenRouterGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 1
  private readonly apiKey: string
  constructor(
    private readonly model: string,
    private readonly options: Options = {},
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }
  async generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedDocument[]> {
    return generateConcurrent(
      specs,
      this.options.concurrency ?? 3,
      onProgress,
      signal,
      async (spec, requestSignal) => {
        const response = await this.request(spec, requestSignal)
        return {
          customId: spec.id,
          text: response.text,
          generator: `openrouter:${response.model}`,
          usage: response.usage,
          telemetry: response.telemetry,
        }
      },
    )
  }
  private async request(spec: DocumentSpec, signal?: AbortSignal) {
    return requestOpenAi(
      this.model,
      this.apiKey,
      this.options,
      {
        max_tokens: 2400,
        temperature: 0.65,
        messages: [
          { role: 'system', content: draftSystemPrompt },
          { role: 'user', content: draftUserPrompt(spec) },
        ],
      },
      spec.id,
      'writer',
      signal,
    )
  }
}

export class OpenRouterLabeler implements LabelingAdapter {
  readonly name: string
  readonly maxChargeAttempts = 1
  private readonly apiKey: string
  constructor(
    private readonly model: string,
    private readonly options: Options & {
      schemaMode?: 'required' | 'unsupported'
    } = {},
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }
  label(
    inputs: LabelInput[],
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ) {
    return this.annotate(inputs, undefined, onProgress, signal)
  }
  repair(
    inputs: LabelInput[],
    feedback: Map<string, string>,
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ) {
    return this.annotate(inputs, feedback, onProgress, signal)
  }
  private async annotate(
    inputs: LabelInput[],
    feedback: Map<string, string> | undefined,
    onProgress: ((progress: GenerationProgress) => void) | undefined,
    signal?: AbortSignal,
  ): Promise<GeneratedAnnotation[]> {
    if (this.options.schemaMode === 'unsupported')
      throw new ProviderConfigurationError(
        `OpenRouter model ${this.model} does not support required JSON-schema annotation mode`,
      )
    return generateConcurrent(
      inputs.map((input) => ({ ...input.spec, draftText: input.text })),
      this.options.concurrency ?? 3,
      onProgress,
      signal,
      async (input, requestSignal) => {
        const response = await requestOpenAi(
          this.model,
          this.apiKey,
          this.options,
          {
            max_tokens: 2400,
            temperature: 0,
            response_format: {
              type: 'json_schema',
              json_schema: annotationSchema,
            },
            messages: [
              { role: 'system', content: labelSystemPrompt },
              {
                role: 'user',
                content: labelUserPrompt(
                  input,
                  input.draftText,
                  feedback?.get(input.id),
                ),
              },
            ],
          },
          input.id,
          'annotator',
          requestSignal,
        )
        return {
          customId: input.id,
          spans: parseAnnotationResponse(
            response.text,
            input.draftText,
            input.id,
          ),
          generator: `openrouter:${response.model}`,
          usage: response.usage,
          telemetry: response.telemetry,
        }
      },
    )
  }
}

export class OpenRouterJudge implements JudgeAdapter {
  readonly name: string
  private readonly apiKey: string
  constructor(
    private readonly model: string,
    private readonly options: Options & {
      schemaMode?: 'required' | 'unsupported'
    } = {},
    private readonly role: 'primary_judge' | 'dispute_judge' = 'primary_judge',
  ) {
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }
  async judge(documents: SyntheticDocument[], signal?: AbortSignal) {
    if (this.options.schemaMode === 'unsupported')
      throw new ProviderConfigurationError(
        `OpenRouter model ${this.model} does not support required JSON-schema judge mode`,
      )
    return generateConcurrent(
      documents,
      this.options.concurrency ?? 3,
      undefined,
      signal,
      async (document, requestSignal) => {
        const response = await requestOpenAi(
          this.model,
          this.apiKey,
          this.options,
          {
            max_tokens: 1200,
            temperature: 0,
            response_format: { type: 'json_schema', json_schema: judgeSchema },
            messages: [{ role: 'user', content: judgePrompt(document) }],
          },
          document.id,
          this.role,
          requestSignal,
        )
        return {
          id: document.id,
          verdict: response.text,
          telemetry: response.telemetry,
        }
      },
    )
  }
}

export class DeepSeekGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 4
  private readonly apiKey: string
  constructor(
    private readonly model: string,
    private readonly options: Options & { retries?: number } = {},
  ) {
    this.name = `deepseek:${model}`
    this.apiKey = requiredEnvironment('DEEPSEEK_API_KEY')
  }
  async generate(
    specs: DocumentSpec[],
    onProgress?: (progress: GenerationProgress) => void,
    signal?: AbortSignal,
  ): Promise<GeneratedDocument[]> {
    return generateConcurrent(
      specs,
      this.options.concurrency ?? 3,
      onProgress,
      signal,
      async (spec, requestSignal) => {
        const response = await withRetries(
          () => this.request(spec, requestSignal),
          this.options.retries ?? 3,
          (error, attempt) =>
            onProgress?.({
              phase: 'retrying',
              completed: 0,
              total: specs.length,
              specId: spec.id,
              attempt,
              reason: retryReason(error),
            }),
          requestSignal,
        )
        return {
          customId: spec.id,
          ...response,
          generator: `deepseek:${response.model}`,
        }
      },
    )
  }
  private async request(spec: DocumentSpec, signal?: AbortSignal) {
    return requestOpenAi(
      this.model,
      this.apiKey,
      this.options,
      {
        max_tokens: 2400,
        temperature: 0.65,
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: draftSystemPrompt },
          { role: 'user', content: draftUserPrompt(spec) },
        ],
      },
      spec.id,
      'writer',
      signal,
      'https://api.deepseek.com',
    )
  }
}

async function requestOpenAi(
  model: string,
  apiKey: string,
  options: Options,
  body: Record<string, unknown>,
  specId: string,
  role: RequestTelemetry['role'],
  outerSignal?: AbortSignal,
  defaultUrl = 'https://openrouter.ai/api/v1',
) {
  const started = performance.now()
  const requestId = `${role}:${specId}:${Date.now()}`
  const signal = outerSignal
    ? AbortSignal.any([
        outerSignal,
        AbortSignal.timeout(options.timeoutMs ?? 120000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 120000)
  try {
    const response = await (options.fetch ?? fetch)(
      `${options.baseUrl ?? defaultUrl}/chat/completions`,
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, ...body }),
      },
    )
    if (!response.ok)
      throw new ProviderHttpError(
        defaultUrl.includes('deepseek') ? 'DeepSeek' : 'OpenRouter',
        response.status,
      )
    const parsed = parseOpenAICompatibleResponse(
      await response.json(),
      defaultUrl.includes('deepseek') ? 'DeepSeek' : 'OpenRouter',
    )
    return {
      ...parsed,
      telemetry: {
        requestId,
        specId,
        role,
        requestedModel: model,
        returnedModel: parsed.model,
        usage: parsed.usage,
        latencyMs: Math.round(performance.now() - started),
        status: 'success',
      } satisfies RequestTelemetry,
    }
  } catch (error) {
    const aborted = signal.aborted
    const telemetry: RequestTelemetry = {
      requestId,
      specId,
      role,
      requestedModel: model,
      latencyMs: Math.round(performance.now() - started),
      status: aborted ? 'aborted' : 'error',
      errorCode:
        error instanceof ProviderHttpError
          ? `http_${error.status}`
          : error instanceof Error
            ? error.name
            : 'unknown',
    }
    throw new ProviderBatchError('Provider request failed', [telemetry])
  }
}

type OpenAICompatibleResponse = {
  model?: unknown
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  choices?: Array<{ message?: { content?: unknown } }>
}
function parseOpenAICompatibleResponse(
  value: unknown,
  provider: string,
): { text: string; model: string; usage: Usage } {
  if (!value || typeof value !== 'object')
    throw new Error(`${provider} returned invalid JSON`)
  const body = value as OpenAICompatibleResponse
  const text = body.choices?.[0]?.message?.content
  const inputTokens = body.usage?.prompt_tokens
  const outputTokens = body.usage?.completion_tokens
  if (
    typeof text !== 'string' ||
    text.trim().length === 0 ||
    typeof body.model !== 'string' ||
    typeof inputTokens !== 'number' ||
    typeof outputTokens !== 'number'
  )
    throw new Error(
      `${provider} response omitted visible text, model, or usage`,
    )
  return { text, model: body.model, usage: { inputTokens, outputTokens } }
}

async function generateConcurrent<T extends { id: string }, Result>(
  values: T[],
  concurrency: number,
  onProgress: ((progress: GenerationProgress) => void) | undefined,
  externalSignal: AbortSignal | undefined,
  operation: (value: T, signal: AbortSignal) => Promise<Result>,
): Promise<Result[]> {
  const output: Result[] = []
  const telemetry: RequestTelemetry[] = []
  const controller = new AbortController()
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, controller.signal])
    : controller.signal
  let next = 0
  let completed = 0
  let failure: unknown
  onProgress?.({ phase: 'submitted', completed, total: values.length })
  const worker = async () => {
    while (!failure && !signal.aborted) {
      const index = next++
      if (index >= values.length) return
      const value = values[index]!
      try {
        const result = await operation(value, signal)
        output[index] = result
        const request = resultTelemetry(result)
        if (request) telemetry.push(request)
        completed++
        onProgress?.({
          phase: 'completed',
          completed,
          total: values.length,
          specId: value.id,
        })
      } catch (error) {
        if (!failure) {
          failure = error
          controller.abort(error)
        }
        if (error instanceof ProviderBatchError)
          telemetry.push(...error.telemetry)
      }
    }
  }
  await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  )
  if (failure)
    throw new ProviderBatchError(
      'Provider batch stopped after terminal failure',
      telemetry,
    )
  return output
}

function resultTelemetry(value: unknown): RequestTelemetry | undefined {
  if (!value || typeof value !== 'object' || !('telemetry' in value))
    return undefined
  const telemetry = value.telemetry
  return telemetry && typeof telemetry === 'object' && 'requestId' in telemetry
    ? (telemetry as RequestTelemetry)
    : undefined
}

async function withRetries<T>(
  operation: () => Promise<T>,
  retries: number,
  onRetry?: (error: unknown, attempt: number) => void,
  signal?: AbortSignal,
) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (signal?.aborted || attempt === retries || !isRetryable(error)) break
      onRetry?.(error, attempt + 1)
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250), signal)
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('DeepSeek request failed')
}
function isRetryable(error: unknown) {
  const code =
    error instanceof ProviderBatchError
      ? error.telemetry[0]?.errorCode
      : undefined
  const status = code?.startsWith('http_') ? Number(code.slice(5)) : undefined
  return (
    status === 408 || status === 429 || (status !== undefined && status >= 500)
  )
}
function retryReason(error: unknown) {
  const code =
    error instanceof ProviderBatchError
      ? error.telemetry[0]?.errorCode
      : undefined
  return code?.startsWith('http_')
    ? `HTTP ${code.slice(5)}`
    : 'transient provider failure'
}
function sleep(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}
