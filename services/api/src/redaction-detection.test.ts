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
