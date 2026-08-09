import { describe, expect, it } from 'vitest'
import type { Span as RampartSpan } from '@obiter/rampart-inference'
import { createRedactionDetector, detectionMode } from './redaction-detection'

const classifier = (async () => []) as never

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('redaction detection', () => {
  it('maps model and deterministic spans then merges supplement overlaps', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => [
        {
          start: 0,
          end: 10,
          label: 'GIVEN_NAME',
          score: 0.99,
          source: 'ner',
          text: 'Jane Smith',
        },
      ],
      log: () => undefined,
    })
    const result = await detect('Jane Smith emailed jane@example.com.')
    expect(result.degraded).toBe(false)
    expect(detectionMode(result.degraded)).toBe('model+supplement')
    expect(result.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: 'Jane Smith',
          category: 'person_name',
          source: 'rampart_model',
        }),
        expect.objectContaining({
          text: 'jane@example.com',
          category: 'email',
          source: 'rampart_deterministic',
        }),
      ]),
    )
  })

  it('returns a successful zero-span result when text contains no detectable PII', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => [],
      log: () => undefined,
    })

    const result = await detect(
      'It is respectfully submitted that the appeal should be allowed.',
    )

    expect(result).toMatchObject({ spans: [], degraded: false })
  })

  it('passes the startup confidence and chunk configuration to NER', async () => {
    let received: { minScore: number; chunkTokens: number } | undefined
    const detect = createRedactionDetector(
      {
        loadClassifier: async () => classifier,
        detectNer: async (_text, _classifier, minScore, chunkTokens) => {
          received = { minScore, chunkTokens }
          return []
        },
        log: () => undefined,
      },
      {
        model: 'example/rampart-test',
        revision: 'revision-1',
        cacheDir: '/tmp/rampart-cache',
        minScore: 0.65,
        chunkTokens: 320,
      },
    )

    const result = await detect('Synthetic text')

    expect(received).toEqual({ minScore: 0.65, chunkTokens: 320 })
    expect(result.detectorVersion).toContain(
      'model=example/rampart-test@revision-1',
    )
  })

  it('degrades to heuristic spans when the model fails to load', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => {
        throw new Error('model load failed')
      },
      log: () => undefined,
    })

    const result = await detect('Email jane@example.com.')

    expect(result.degraded).toBe(true)
    expect(result.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'email',
          source: 'rampart_deterministic',
        }),
      ]),
    )
  })

  it('keeps heuristic hits when NER fails after loading', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => {
        throw new Error('inference failed')
      },
      log: () => undefined,
    })
    const result = await detect('Email jane@example.com.')
    expect(result.degraded).toBe(true)
    expect(detectionMode(result.degraded)).toBe('heuristics+supplement')
    expect(result.detectorVersion).toContain('mode=heuristics+supplement')
    expect(result.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'email',
          source: 'rampart_deterministic',
        }),
      ]),
    )
  })

  it('degrades to heuristic spans when projection fails after inference', async () => {
    const modelSpan: RampartSpan = {
      start: 0,
      end: 4,
      label: 'GIVEN_NAME',
      score: 0.99,
      source: 'ner',
      text: 'Jane',
    }
    Object.defineProperty(modelSpan, 'end', {
      get: () => {
        throw new Error('projection failed')
      },
    })
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => [modelSpan],
      log: () => undefined,
    })

    const result = await detect('Email jane@example.com.')

    expect(result.degraded).toBe(true)
    expect(detectionMode(result.degraded)).toBe('heuristics+supplement')
    expect(result.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'email',
          source: 'rampart_deterministic',
        }),
      ]),
    )
  })

  it('serializes concurrent NER inference on the shared classifier', async () => {
    const first = deferred<void>()
    let inFlight = 0
    let maxInFlight = 0
    let invocations = 0
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => {
        invocations++
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (invocations === 1) await first.promise
        inFlight--
        return []
      },
      log: () => undefined,
    })

    const firstRequest = detect('first request')
    const secondRequest = detect('second request')
    await Promise.resolve()
    await Promise.resolve()
    expect(invocations).toBe(1)
    first.resolve()
    await Promise.all([firstRequest, secondRequest])
    expect(maxInFlight).toBe(1)
  })

  it('does not clear a newer classifier reload when an older request fails', async () => {
    const firstFailure = deferred<void>()
    const secondFailure = deferred<void>()
    let loads = 0
    let invocations = 0
    const detect = createRedactionDetector({
      loadClassifier: async () => {
        loads++
        return classifier
      },
      detectNer: async () => {
        invocations++
        if (invocations === 1) {
          await firstFailure.promise
          throw new Error('first failure')
        }
        if (invocations === 2) {
          await secondFailure.promise
          throw new Error('second failure')
        }
        return []
      },
      log: () => undefined,
    })

    const firstRequest = detect('first request')
    const secondRequest = detect('second request')
    await Promise.resolve()
    firstFailure.resolve()
    await firstRequest

    const reloadRequest = detect('reload request')
    await Promise.resolve()
    secondFailure.resolve()
    await Promise.all([secondRequest, reloadRequest])

    await detect('warm request')
    expect(loads).toBe(2)
  })

  it('loads the model on warm so the first request does not pay for the download', async () => {
    let loads = 0
    const detect = createRedactionDetector({
      loadClassifier: async () => {
        loads++
        return classifier
      },
      detectNer: async () => [],
      log: () => undefined,
    })

    await detect.warm()
    expect(loads).toBe(1)

    const result = await detect('Email jane@example.com.')

    expect(result.degraded).toBe(false)
    expect(loads).toBe(1)
  })

  it('rejects a failed warm without pinning the failure on later requests', async () => {
    let loads = 0
    const detect = createRedactionDetector({
      loadClassifier: async () => {
        loads++
        if (loads === 1) throw new Error('offline')
        return classifier
      },
      detectNer: async () => [],
      log: () => undefined,
    })

    await expect(detect.warm()).rejects.toThrow('offline')

    const result = await detect('Email jane@example.com.')

    expect(result.degraded).toBe(false)
    expect(loads).toBe(2)
  })

  it('premasks heuristic hits before NER and projects offsets to the original text', async () => {
    const prefix = `jane@example.com ${'word '.repeat(600)}`
    const text = `${prefix}Jane Smith`
    let nerInput = ''
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => {
        nerInput = masked
        return [
          {
            start: masked.indexOf('Jane'),
            end: masked.length,
            label: 'SURNAME',
            score: 0.9,
            source: 'ner',
            text: 'Jane Smith',
          },
        ]
      },
      log: () => undefined,
    })
    const result = await detect(text)
    expect(nerInput).toContain('[EMAIL]')
    expect(nerInput).not.toContain('jane@example.com')
    expect(result.spans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          start: prefix.length,
          end: text.length,
          text: 'Jane Smith',
        }),
      ]),
    )
  })
})
