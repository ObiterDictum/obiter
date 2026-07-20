import { afterEach, describe, expect, it } from 'vitest'
import { OpenRouterLabeler, ProviderBatchError } from './providers'
import type { LabelInput } from './types'

const previous = process.env.OPENROUTER_API_KEY
afterEach(() => {
  if (previous === undefined) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = previous
})
const input: LabelInput = {
  spec: {
    id: 'doc-1',
    docType: 'witness_statement',
    requiredCategories: [],
    register: 'formal_pleading',
    difficulty: 'standard',
    lengthWords: 1,
    seed: 's',
    scenario: 's',
    hardNegatives: [],
    matrixCells: [],
  },
  text: 'Fictional source.',
}

function parseRequestBody(
  value: BodyInit | null | undefined,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(String(value))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    return { ...parsed }
  } catch {
    throw new Error('Mock received invalid JSON request body')
  }
}

function fakeFetch(
  handler: (body: Record<string, unknown>) => Response,
): typeof fetch {
  return async (_input, init) => handler(parseRequestBody(init?.body))
}

describe('OpenRouter schema and offline failure behaviour', () => {
  it('requests strict JSON schema and keeps local quote validation', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let body: Record<string, unknown> | undefined
    const labeler = new OpenRouterLabeler('fake/model', {
      fetch: fakeFetch((request) => {
        body = request
        return new Response(
          JSON.stringify({
            model: 'fake/model',
            usage: { prompt_tokens: 2, completion_tokens: 3 },
            choices: [
              {
                message: {
                  content: JSON.stringify({ id: 'doc-1', spans: [] }),
                },
              },
            ],
          }),
        )
      }),
    })
    await expect(labeler.label([input])).resolves.toHaveLength(1)
    expect(body?.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true },
    })
  })
  it('stops dequeueing after terminal failure and preserves failure telemetry', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    let calls = 0
    const labeler = new OpenRouterLabeler('fake/model', {
      concurrency: 1,
      fetch: fakeFetch(() => {
        calls++
        return new Response('failure', { status: 500 })
      }),
    })
    await expect(
      labeler.label([
        input,
        { ...input, spec: { ...input.spec, id: 'doc-2' } },
        { ...input, spec: { ...input.spec, id: 'doc-3' } },
      ]),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof ProviderBatchError && error.telemetry.length === 1,
    )
    expect(calls).toBe(1)
  })
  it('rejects models explicitly configured without required schema support', async () => {
    process.env.OPENROUTER_API_KEY = 'offline-test-only'
    const labeler = new OpenRouterLabeler('fake/model', {
      schemaMode: 'unsupported',
    })
    await expect(labeler.label([input])).rejects.toThrow('does not support')
  })
})
