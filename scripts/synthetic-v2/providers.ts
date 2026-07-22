import { parseAnnotationResponse } from './annotations'
import {
  draftSystemPrompt,
  draftUserPrompt,
  labelSystemPrompt,
  labelUserPrompt,
} from './prompts'
import {
  evaluateIndependentReference,
  judgePrompt,
  parseIndependentJudgeReference,
} from './qa'
import {
  spanCategories,
  type DocumentSpec,
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
    readonly detailCode?: string,
  ) {
    super(`${provider} request failed with HTTP ${status}`)
    this.name = 'ProviderHttpError'
  }
}

async function providerHttpError(provider: string, response: Response) {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return new ProviderHttpError(provider, response.status)
  }
  const error =
    body && typeof body === 'object' && 'error' in body
      ? (body as { error?: unknown }).error
      : body
  if (!error || typeof error !== 'object')
    return new ProviderHttpError(provider, response.status)
  const detail = error as { type?: unknown; code?: unknown; param?: unknown }
  const safeParts = [detail.type, detail.code, detail.param]
    .filter(
      (value): value is string =>
        typeof value === 'string' &&
        value.length <= 64 &&
        /^[a-zA-Z0-9_./-]+$/.test(value),
    )
    .map((value) => value.toLowerCase())
  return new ProviderHttpError(
    provider,
    response.status,
    safeParts.length ? [...new Set(safeParts)].join(':') : undefined,
  )
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
          required: ['category', 'startToken', 'endToken'],
          properties: {
            category: { type: 'string', enum: spanCategories },
            startToken: { type: 'integer', minimum: 0 },
            endToken: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
  },
} as const
const quoteOccurrenceSpanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['category', 'quote', 'occurrence'],
  properties: {
    category: { type: 'string', enum: spanCategories },
    quote: { type: 'string', minLength: 1 },
    occurrence: { type: 'integer', minimum: 1 },
  },
} as const
const judgeSchema = {
  name: 'synthetic_v2_structured_review',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'proposedSpanDecisions',
      'missingSpans',
      'hardNegativeAssertions',
      'realismScore',
      'confidence',
      'rationale',
    ],
    properties: {
      id: { type: 'string' },
      proposedSpanDecisions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'action', 'correctedCategory'],
          properties: {
            index: { type: 'integer', minimum: 0 },
            action: {
              type: 'string',
              enum: ['keep', 'remove', 'recategorize'],
            },
            correctedCategory: {
              anyOf: [
                { type: 'string', enum: spanCategories },
                { type: 'null' },
              ],
            },
          },
        },
      },
      missingSpans: { type: 'array', items: quoteOccurrenceSpanSchema },
      hardNegativeAssertions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['assertionId', 'correctlyUnlabelled'],
          properties: {
            assertionId: { type: 'string', minLength: 1 },
            correctlyUnlabelled: { type: 'boolean' },
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
    readonly model: string,
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
  readonly maxChargeAttempts = 2
  private readonly apiKey: string
  constructor(
    readonly model: string,
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
        const retryTelemetry: RequestTelemetry[] = []
        let previousRequestId: string | undefined
        let previousValidationMessage: string | undefined
        for (let attempt = 1; attempt <= 2; attempt++) {
          const validationFeedback =
            attempt === 1
              ? feedback?.get(input.id)
              : `The previous response failed local validation: ${previousValidationMessage ?? 'unknown validation error'}. Return a complete replacement list using only valid non-overlapping token ranges from the immutable source. Do not invent a span for an absent requirement.`
          let response: {
            text: string
            model: string
            usage: Usage
            telemetry: RequestTelemetry
          }
          try {
            response = await requestOpenAi(
              this.model,
              this.apiKey,
              this.options,
              {
                max_tokens: 2400,
                temperature: 0,
                reasoning: { effort: 'minimal' },
                tools: [
                  {
                    type: 'function',
                    function: {
                      name: annotationSchema.name,
                      description: 'Submit the complete annotation span list.',
                      parameters: annotationSchema.schema,
                    },
                  },
                ],
                tool_choice: {
                  type: 'function',
                  function: { name: annotationSchema.name },
                },
                provider: { require_parameters: true },
                messages: [
                  { role: 'system', content: labelSystemPrompt },
                  {
                    role: 'user',
                    content: labelUserPrompt(
                      input,
                      input.draftText,
                      validationFeedback,
                    ),
                  },
                ],
              },
              input.id,
              'annotator',
              requestSignal,
              'https://openrouter.ai/api/v1',
              attempt,
              'openrouter',
              annotationSchema.name,
            )
          } catch (error) {
            if (error instanceof ProviderBatchError)
              for (const entry of error.telemetry) {
                retryTelemetry.push({
                  ...entry,
                  retryOfRequestId: previousRequestId,
                })
                previousRequestId = entry.requestId
              }
            if (attempt < 2 && isRetryable(error)) continue
            throw new ProviderBatchError(
              'Annotation request failed after bounded attempts',
              retryTelemetry,
            )
          }
          try {
            return {
              customId: input.id,
              spans: parseAnnotationResponse(
                response.text,
                input.draftText,
                input.id,
              ),
              generator: `openrouter:${response.model}`,
              usage: response.usage,
              telemetry: {
                ...response.telemetry,
                retryOfRequestId: previousRequestId,
              },
              retryTelemetry,
            }
          } catch (error) {
            previousValidationMessage =
              error instanceof Error
                ? error.message
                : 'unknown validation error'
            const failure = {
              ...response.telemetry,
              status: 'error',
              errorCode: annotationValidationErrorCode(error),
              retryOfRequestId: previousRequestId,
            } satisfies RequestTelemetry
            retryTelemetry.push(failure)
            previousRequestId = response.telemetry.requestId
            if (attempt === 2)
              throw new ProviderBatchError(
                'Annotation response failed validation twice',
                retryTelemetry,
              )
          }
        }
        throw new Error('Annotation retry loop terminated unexpectedly')
      },
    )
  }
}

export const judgeProviders = ['openrouter', 'zai', 'opencode-go'] as const
export type JudgeProvider = (typeof judgeProviders)[number]
type JudgeRole = 'primary_judge' | 'dispute_judge'
type JudgeOptions = Options & { schemaMode?: 'required' | 'unsupported' }

const openCodeGoAnthropicModels = new Set([
  'minimax-m2.5',
  'minimax-m2.7',
  'minimax-m3',
  'qwen3.6-plus',
  'qwen3.7-max',
  'qwen3.7-plus',
])
const openCodeGoOpenAiModels = new Set([
  'glm-5.1',
  'glm-5.2',
  'grok-4.5',
  'kimi-k2.6',
  'kimi-k2.7-code',
  'kimi-k3',
  'mimo-v2.5',
  'mimo-v2.5-pro',
])

abstract class IndependentJudge implements JudgeAdapter {
  abstract readonly name: string
  readonly maxChargeAttempts = 2
  protected abstract request(
    document: SyntheticDocument,
    signal?: AbortSignal,
    validationFeedback?: string,
    attempt?: number,
  ): Promise<{
    text: string
    telemetry: RequestTelemetry
    finishReason?: string
  }>

  constructor(
    readonly model: string,
    protected readonly options: JudgeOptions = {},
    protected readonly role: JudgeRole = 'primary_judge',
  ) {}

  async judge(documents: SyntheticDocument[], signal?: AbortSignal) {
    if (this.options.schemaMode === 'unsupported')
      throw new ProviderConfigurationError(
        `${this.name} does not support the required structured judge mode`,
      )
    return generateConcurrent(
      documents,
      this.options.concurrency ?? 3,
      undefined,
      signal,
      async (document, requestSignal) => {
        const retryTelemetry: RequestTelemetry[] = []
        let previousRequestId: string | undefined
        let validationFeedback: string | undefined
        for (let attempt = 1; attempt <= 2; attempt++) {
          let response: {
            text: string
            telemetry: RequestTelemetry
            finishReason?: string
          }
          try {
            response = await this.request(
              document,
              requestSignal,
              validationFeedback,
              attempt,
            )
          } catch (error) {
            if (error instanceof ProviderBatchError)
              for (const entry of error.telemetry) {
                retryTelemetry.push({
                  ...entry,
                  retryOfRequestId: previousRequestId,
                })
                previousRequestId = entry.requestId
              }
            if (attempt < 2 && isRetryable(error)) continue
            throw new ProviderBatchError(
              'Judge request failed after bounded attempts',
              retryTelemetry,
            )
          }
          try {
            // Provider constraints reduce malformed output; this local parse is
            // still authoritative and validates quotes against immutable text.
            evaluateIndependentReference(
              document,
              parseIndependentJudgeReference(
                response.text,
                document.id,
                document,
              ),
            )
            return {
              id: document.id,
              verdict: response.text,
              telemetry: {
                ...response.telemetry,
                retryOfRequestId: previousRequestId,
              },
              retryTelemetry,
            }
          } catch (error) {
            validationFeedback =
              error instanceof Error
                ? error.message
                : 'unknown validation error'
            retryTelemetry.push({
              ...response.telemetry,
              status: 'error',
              errorCode:
                response.finishReason === 'length'
                  ? 'judge_output_truncated'
                  : judgeValidationErrorCode(error),
              retryOfRequestId: previousRequestId,
            })
            previousRequestId = response.telemetry.requestId
            if (attempt === 2)
              throw new ProviderBatchError(
                'Judge reference failed validation twice',
                retryTelemetry,
              )
          }
        }
        throw new Error('Judge retry loop terminated unexpectedly')
      },
    )
  }
}

export class OpenRouterJudge extends IndependentJudge {
  readonly name: string
  private readonly apiKey: string

  constructor(
    model: string,
    options: JudgeOptions = {},
    role: JudgeRole = 'primary_judge',
  ) {
    super(model, options, role)
    this.name = `openrouter:${model}`
    this.apiKey = requiredEnvironment('OPENROUTER_API_KEY')
  }

  protected request(
    document: SyntheticDocument,
    signal?: AbortSignal,
    validationFeedback?: string,
    attempt = 1,
  ) {
    return requestOpenAi(
      this.model,
      this.apiKey,
      this.options,
      {
        max_tokens: 2400,
        ...(this.model.startsWith('openai/gpt-5')
          ? { reasoning: { effort: 'none' } }
          : { temperature: 0 }),
        response_format: { type: 'json_schema', json_schema: judgeSchema },
        provider: { require_parameters: true },
        messages: [
          {
            role: 'user',
            content: judgePrompt(document, validationFeedback),
          },
        ],
      },
      document.id,
      this.role,
      signal,
      'https://openrouter.ai/api/v1',
      attempt,
    )
  }
}

export class ZaiJudge extends IndependentJudge {
  readonly name: string
  private readonly apiKey: string

  constructor(
    model: string,
    options: JudgeOptions = {},
    role: JudgeRole = 'primary_judge',
  ) {
    super(model, options, role)
    this.name = `zai:${model}`
    if (process.env.OBITER_ZAI_GENERAL_API_CONFIRMED !== '1')
      throw new ProviderConfigurationError(
        'Set OBITER_ZAI_GENERAL_API_CONFIRMED=1 only for a general Z.ai API key; Coding Plan keys are not eligible',
      )
    this.apiKey = requiredEnvironment('ZAI_API_KEY')
  }

  protected request(
    document: SyntheticDocument,
    signal?: AbortSignal,
    validationFeedback?: string,
    attempt = 1,
  ) {
    return requestOpenAi(
      this.model,
      this.apiKey,
      this.options,
      {
        max_tokens: 2400,
        temperature: 0,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: jsonSchemaInstruction(judgeSchema.schema),
          },
          {
            role: 'user',
            content: judgePrompt(document, validationFeedback),
          },
        ],
      },
      document.id,
      this.role,
      signal,
      'https://api.z.ai/api/paas/v4',
      attempt,
      'zai',
    )
  }
}

export class OpenCodeGoJudge extends IndependentJudge {
  readonly name: string
  private readonly apiKey: string

  constructor(
    model: string,
    options: JudgeOptions = {},
    role: JudgeRole = 'primary_judge',
  ) {
    super(model, options, role)
    this.name = `opencode-go:${model}`
    if (process.env.OBITER_OPENCODE_GO_TERMS_CONFIRMED !== '1')
      throw new ProviderConfigurationError(
        'Set OBITER_OPENCODE_GO_TERMS_CONFIRMED=1 after reviewing the Go API terms',
      )
    this.apiKey = requiredEnvironment('OPENCODE_GO_API_KEY')
    if (
      !openCodeGoOpenAiModels.has(model) &&
      !openCodeGoAnthropicModels.has(model)
    )
      throw new ProviderConfigurationError(
        `OpenCode Go model ${model} is not in the reviewed endpoint allowlist`,
      )
  }

  protected request(
    document: SyntheticDocument,
    signal?: AbortSignal,
    validationFeedback?: string,
    attempt = 1,
  ) {
    if (openCodeGoAnthropicModels.has(this.model))
      return requestAnthropicTool(
        this.model,
        this.apiKey,
        this.options,
        document,
        this.role,
        signal,
        validationFeedback,
        attempt,
      )
    return requestOpenAi(
      this.model,
      this.apiKey,
      this.options,
      {
        max_tokens: 2400,
        temperature: 0,
        ...(this.model.startsWith('glm-')
          ? {
              thinking: { type: 'disabled' },
              reasoning_effort: 'none',
            }
          : {}),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: jsonSchemaInstruction(judgeSchema.schema),
          },
          {
            role: 'user',
            content: judgePrompt(document, validationFeedback),
          },
        ],
      },
      document.id,
      this.role,
      signal,
      'https://opencode.ai/zen/go/v1',
      attempt,
      'opencode-go',
    )
  }
}

export function createJudgeAdapter(
  provider: JudgeProvider,
  model: string,
  role: JudgeRole = 'primary_judge',
): JudgeAdapter {
  if (provider === 'zai') return new ZaiJudge(model, {}, role)
  if (provider === 'opencode-go') return new OpenCodeGoJudge(model, {}, role)
  return new OpenRouterJudge(model, {}, role)
}

export function parseJudgeProvider(value: string | undefined, name: string) {
  if (value && judgeProviders.some((provider) => provider === value))
    return value as JudgeProvider
  throw new ProviderConfigurationError(
    `${name} must be one of: ${judgeProviders.join(', ')}`,
  )
}

function jsonSchemaInstruction(schema: unknown) {
  return `Return only one JSON object matching this schema exactly. Do not include markdown.\n${JSON.stringify(schema)}`
}

function judgeValidationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('invalid JSON')) return 'judge_invalid_json'
  if (
    message.includes('requires category, quote, and occurrence') ||
    message.includes('invalid span decision')
  )
    return 'judge_span_shape_invalid'
  if (message.includes('omitted proposed span decisions'))
    return 'judge_span_decisions_incomplete'
  if (message.includes('review ID does not match')) return 'judge_id_mismatch'
  if (message.includes('invalid review')) return 'judge_review_shape_invalid'
  if (message.includes('hard-negative evidence'))
    return 'judge_hard_negative_evidence_invalid'
  if (
    message.includes('quote is not an exact source substring') ||
    message.includes('quote occurrence')
  )
    return 'judge_quote_or_occurrence_invalid'
  if (message.includes('Overlapping or nested spans'))
    return 'judge_span_overlap'
  return 'judge_reference_validation_failed'
}

function annotationValidationErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('ID does not match')) return 'annotation_id_mismatch'
  if (message.includes('quote is not in source'))
    return 'annotation_quote_not_in_source'
  if (message.includes('quote occurrence is out of range'))
    return 'annotation_occurrence_out_of_range'
  if (message.includes('offsets do not match'))
    return 'annotation_offset_mismatch'
  if (
    message.includes('spans overlap') ||
    message.includes('Overlapping or nested spans')
  )
    return 'annotation_span_overlap'
  if (message.includes('not valid JSON')) return 'annotation_invalid_json'
  if (
    message.includes('requires category, quote, and occurrence') ||
    message.includes('requires category and a valid token range') ||
    message.includes('must contain spans')
  )
    return 'annotation_span_shape_invalid'
  if (message.includes('Offset round-trip failed'))
    return 'annotation_offset_round_trip_failed'
  return 'annotation_validation_failed'
}

export class DeepSeekGenerator implements GeneratorAdapter {
  readonly name: string
  readonly maxChargeAttempts = 4
  private readonly apiKey: string
  constructor(
    readonly model: string,
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
        const retryTelemetry: RequestTelemetry[] = []
        let previousRequestId: string | undefined
        try {
          const response = await withRetries(
            (attempt) => this.request(spec, requestSignal, attempt),
            this.options.retries ?? 3,
            (error, attempt) => {
              if (error instanceof ProviderBatchError)
                for (const entry of error.telemetry) {
                  retryTelemetry.push({
                    ...entry,
                    retryOfRequestId: previousRequestId,
                  })
                  previousRequestId = entry.requestId
                }
              onProgress?.({
                phase: 'retrying',
                completed: 0,
                total: specs.length,
                specId: spec.id,
                attempt,
                reason: retryReason(error),
              })
            },
            requestSignal,
          )
          return {
            customId: spec.id,
            ...response,
            generator: `deepseek:${response.model}`,
            retryTelemetry,
          }
        } catch (error) {
          if (error instanceof ProviderBatchError) {
            const terminal = error.telemetry.map((entry) => ({
              ...entry,
              retryOfRequestId: previousRequestId,
            }))
            throw new ProviderBatchError('DeepSeek retries exhausted', [
              ...retryTelemetry,
              ...terminal,
            ])
          }
          throw error
        }
      },
    )
  }
  private async request(
    spec: DocumentSpec,
    signal: AbortSignal | undefined,
    attempt: number,
  ) {
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
      attempt,
      'deepseek',
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
  attempt = 1,
  provider = 'openrouter',
  expectedToolName?: string,
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
    if (!response.ok) throw await providerHttpError(provider, response)
    const responseBody: unknown = await response.json()
    let parsed: ReturnType<typeof parseOpenAICompatibleResponse>
    try {
      parsed = parseOpenAICompatibleResponse(
        responseBody,
        provider,
        expectedToolName,
      )
    } catch (error) {
      const evidence = openAiBillingEvidence(responseBody)
      throw new ProviderBatchError('Provider response was invalid', [
        {
          requestId,
          specId,
          role,
          provider,
          requestedModel: model,
          returnedModel: evidence.returnedModel,
          usage: evidence.usage,
          latencyMs: Math.round(performance.now() - started),
          status: 'error',
          errorCode: providerErrorCode(error),
          attempt,
        },
      ])
    }
    if (parsed.model !== model) {
      throw new ProviderBatchError('Provider returned an unrequested model', [
        {
          requestId,
          specId,
          role,
          provider,
          requestedModel: model,
          returnedModel: parsed.model,
          usage: parsed.usage,
          latencyMs: Math.round(performance.now() - started),
          status: 'error',
          errorCode: 'model_identity_mismatch',
          attempt,
        },
      ])
    }
    return {
      ...parsed,
      telemetry: {
        requestId,
        specId,
        role,
        provider,
        requestedModel: model,
        returnedModel: parsed.model,
        usage: parsed.usage,
        latencyMs: Math.round(performance.now() - started),
        status: 'success',
        attempt,
      } satisfies RequestTelemetry,
    }
  } catch (error) {
    if (error instanceof ProviderBatchError) throw error
    const aborted = signal.aborted
    const telemetry: RequestTelemetry = {
      requestId,
      specId,
      role,
      provider,
      requestedModel: model,
      latencyMs: Math.round(performance.now() - started),
      status: aborted ? 'aborted' : 'error',
      attempt,
      errorCode:
        error instanceof ProviderHttpError
          ? `http_${error.status}${error.detailCode ? `:${error.detailCode}` : ''}`
          : error instanceof Error
            ? error.name
            : 'unknown',
    }
    throw new ProviderBatchError('Provider request failed', [telemetry])
  }
}

async function requestAnthropicTool(
  model: string,
  apiKey: string,
  options: Options,
  document: SyntheticDocument,
  role: JudgeRole,
  outerSignal?: AbortSignal,
  validationFeedback?: string,
  attempt = 1,
) {
  const provider = 'opencode-go'
  const specId = document.id
  const requestId = `${role}:${specId}:${Date.now()}`
  const started = performance.now()
  const signal = outerSignal
    ? AbortSignal.any([
        outerSignal,
        AbortSignal.timeout(options.timeoutMs ?? 120000),
      ])
    : AbortSignal.timeout(options.timeoutMs ?? 120000)
  try {
    const response = await (options.fetch ?? fetch)(
      `${options.baseUrl ?? 'https://opencode.ai/zen/go/v1'}/messages`,
      {
        method: 'POST',
        signal,
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 1200,
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: judgePrompt(document, validationFeedback),
            },
          ],
          tools: [
            {
              name: judgeSchema.name,
              description: 'Submit the independent reference annotation.',
              input_schema: judgeSchema.schema,
            },
          ],
          tool_choice: { type: 'tool', name: judgeSchema.name },
        }),
      },
    )
    if (!response.ok) throw await providerHttpError(provider, response)
    const responseBody: unknown = await response.json()
    let parsed: ReturnType<typeof parseAnthropicToolResponse>
    try {
      parsed = parseAnthropicToolResponse(responseBody, provider)
    } catch (error) {
      const evidence = anthropicBillingEvidence(responseBody)
      throw new ProviderBatchError('Provider response was invalid', [
        {
          requestId,
          specId,
          role,
          provider,
          requestedModel: model,
          returnedModel: evidence.returnedModel,
          usage: evidence.usage,
          latencyMs: Math.round(performance.now() - started),
          status: 'error',
          errorCode: providerErrorCode(error),
          attempt,
        },
      ])
    }
    const telemetry = {
      requestId,
      specId,
      role,
      provider,
      requestedModel: model,
      returnedModel: parsed.model,
      usage: parsed.usage,
      latencyMs: Math.round(performance.now() - started),
      status: 'success',
      attempt,
    } satisfies RequestTelemetry
    if (parsed.model !== model)
      throw new ProviderBatchError('Provider returned an unrequested model', [
        {
          ...telemetry,
          status: 'error',
          errorCode: 'model_identity_mismatch',
        },
      ])
    return { ...parsed, telemetry }
  } catch (error) {
    if (error instanceof ProviderBatchError) throw error
    const aborted = signal.aborted
    throw new ProviderBatchError('Provider request failed', [
      {
        requestId,
        specId,
        role,
        provider,
        requestedModel: model,
        latencyMs: Math.round(performance.now() - started),
        status: aborted ? 'aborted' : 'error',
        attempt,
        errorCode:
          error instanceof ProviderHttpError
            ? `http_${error.status}${error.detailCode ? `:${error.detailCode}` : ''}`
            : error instanceof Error
              ? error.name
              : 'unknown',
      },
    ])
  }
}

type AnthropicToolResponse = {
  model?: unknown
  usage?: { input_tokens?: unknown; output_tokens?: unknown }
  content?: Array<{ type?: unknown; name?: unknown; input?: unknown }>
}
function parseAnthropicToolResponse(value: unknown, provider: string) {
  if (!value || typeof value !== 'object')
    throw new Error(`${provider} returned invalid JSON`)
  const body = value as AnthropicToolResponse
  const tool = body.content?.find(
    (entry) =>
      entry.type === 'tool_use' &&
      entry.name === judgeSchema.name &&
      entry.input !== undefined,
  )
  const inputTokens = body.usage?.input_tokens
  const outputTokens = body.usage?.output_tokens
  if (
    !tool ||
    typeof body.model !== 'string' ||
    !isTokenCount(inputTokens) ||
    !isTokenCount(outputTokens)
  )
    throw new Error(
      `${provider} response omitted judge tool input, model, or usage`,
    )
  return {
    text: JSON.stringify(tool.input),
    model: body.model,
    usage: { inputTokens, outputTokens } satisfies Usage,
  }
}

type OpenAICompatibleResponse = {
  model?: unknown
  usage?: {
    prompt_tokens?: unknown
    completion_tokens?: unknown
    input_tokens?: unknown
    output_tokens?: unknown
  }
  choices?: Array<{
    finish_reason?: unknown
    message?: {
      content?: unknown
      tool_calls?: Array<{
        function?: { name?: unknown; arguments?: unknown }
      }>
    }
  }>
}
function parseOpenAICompatibleResponse(
  value: unknown,
  provider: string,
  expectedToolName?: string,
): { text: string; model: string; usage: Usage; finishReason?: string } {
  if (!value || typeof value !== 'object')
    throw new Error(`${provider} returned invalid JSON`)
  const body = value as OpenAICompatibleResponse
  const message = body.choices?.[0]?.message
  const toolCalls = message?.tool_calls
  const selectedTool = expectedToolName
    ? toolCalls?.find((call) => call.function?.name === expectedToolName)
    : undefined
  if (expectedToolName && toolCalls?.length && !selectedTool)
    throw providerResponseError(provider, 'tool_name_mismatch')
  const toolArguments = selectedTool?.function?.arguments
  if (selectedTool && toolArguments === undefined)
    throw providerResponseError(provider, 'missing_tool_arguments')
  // Some OpenRouter model routes honour the forced schema but normalize the
  // result into assistant content instead of an OpenAI tool_calls entry. The
  // same authoritative local parser validates either transport shape.
  const rawText = selectedTool ? toolArguments : message?.content
  const text =
    selectedTool && rawText && typeof rawText === 'object'
      ? JSON.stringify(rawText)
      : openAiText(rawText)
  if (expectedToolName && !selectedTool && !text)
    throw providerResponseError(provider, 'missing_tool_call')
  const inputTokens = body.usage?.prompt_tokens ?? body.usage?.input_tokens
  const outputTokens =
    body.usage?.completion_tokens ?? body.usage?.output_tokens
  if (!text) throw providerResponseError(provider, 'missing_output')
  if (typeof body.model !== 'string')
    throw providerResponseError(provider, 'missing_model')
  if (!isTokenCount(inputTokens) || !isTokenCount(outputTokens))
    throw providerResponseError(provider, 'missing_usage')
  const finishReason = body.choices?.[0]?.finish_reason
  return {
    text,
    model: body.model,
    usage: { inputTokens, outputTokens },
    finishReason: typeof finishReason === 'string' ? finishReason : undefined,
  }
}

function openAiBillingEvidence(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const body = value as OpenAICompatibleResponse
  const inputTokens = body.usage?.prompt_tokens ?? body.usage?.input_tokens
  const outputTokens =
    body.usage?.completion_tokens ?? body.usage?.output_tokens
  return {
    returnedModel: typeof body.model === 'string' ? body.model : undefined,
    usage:
      isTokenCount(inputTokens) && isTokenCount(outputTokens)
        ? ({ inputTokens, outputTokens } satisfies Usage)
        : undefined,
  }
}

function anthropicBillingEvidence(value: unknown) {
  if (!value || typeof value !== 'object') return {}
  const body = value as AnthropicToolResponse
  const inputTokens = body.usage?.input_tokens
  const outputTokens = body.usage?.output_tokens
  return {
    returnedModel: typeof body.model === 'string' ? body.model : undefined,
    usage:
      isTokenCount(inputTokens) && isTokenCount(outputTokens)
        ? ({ inputTokens, outputTokens } satisfies Usage)
        : undefined,
  }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function providerErrorCode(error: unknown) {
  return error instanceof Error ? error.name : 'unknown'
}

function providerResponseError(provider: string, reason: string) {
  const error = new Error(`${provider} response ${reason.replaceAll('_', ' ')}`)
  error.name = `provider_${reason}`
  return error
}

function openAiText(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value
  if (!Array.isArray(value)) return undefined
  const text = value
    .flatMap((part) =>
      part && typeof part === 'object' && 'text' in part
        ? [(part as { text?: unknown }).text]
        : [],
    )
    .filter((part): part is string => typeof part === 'string')
    .join('')
  return text.trim() ? text : undefined
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
        telemetry.push(...requestTelemetryFromResult(result))
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

export function requestTelemetryFromResult(value: unknown): RequestTelemetry[] {
  if (!value || typeof value !== 'object') return []
  const result = value as { telemetry?: unknown; retryTelemetry?: unknown }
  const retries = Array.isArray(result.retryTelemetry)
    ? result.retryTelemetry.filter(isRequestTelemetry)
    : []
  return [
    ...retries,
    ...(isRequestTelemetry(result.telemetry) ? [result.telemetry] : []),
  ]
}

function isRequestTelemetry(value: unknown): value is RequestTelemetry {
  return Boolean(value && typeof value === 'object' && 'requestId' in value)
}

async function withRetries<T>(
  operation: (attempt: number) => Promise<T>,
  retries: number,
  onRetry?: (error: unknown, attempt: number) => void,
  signal?: AbortSignal,
) {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation(attempt + 1)
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
    code === 'TimeoutError' ||
    code === 'TypeError' ||
    status === 408 ||
    status === 429 ||
    (status !== undefined && status >= 500)
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
