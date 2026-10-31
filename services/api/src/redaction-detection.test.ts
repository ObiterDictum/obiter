import { describe, expect, it } from 'bun:test'
import type { Span as RampartSpan } from '@obiter/rampart-inference'
import { createRedactionDetector, detectionMode } from './redaction-detection'
import {
  DETECTION_WINDOW_CHARS,
  planDetectionWindows,
} from './redaction-detection-windows'

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

  it('does not propose a court claim number or court name as personal data', async () => {
    const text =
      'Claim No. LS26C00418  |  In the County Court at Leicester\n\n' +
      'I, Priya Shah, of 14 Elmfield Avenue, Leicester LE2 1RB, will say as follows.'
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => {
        const span = (
          needle: string,
          label: RampartSpan['label'],
          from = 0,
        ): RampartSpan => {
          const start = masked.indexOf(needle, from)
          return {
            start,
            end: start + needle.length,
            label,
            score: 0.7,
            source: 'ner',
            text: needle,
          }
        }
        const court = masked.indexOf('Leicester')
        return [
          span('LS26C00418', 'DRIVERS_LICENSE'),
          span('Leicester', 'CITY', court),
          span('Leicester', 'CITY', court + 1),
          span('14', 'BUILDING_NUMBER'),
          span('Elmfield Avenue', 'STREET_NAME'),
        ]
      },
      log: () => undefined,
    })

    const { spans } = await detect(text)

    expect(spans.map((span) => span.text)).not.toContain('LS26C00418')
    expect(
      spans
        .filter((span) => span.category === 'address')
        .map((span) => span.text),
    ).toEqual(['14', 'Elmfield Avenue', 'Leicester', 'LE2 1RB'])
    expect(spans.find((span) => span.text === 'Leicester')?.start).toBe(
      text.lastIndexOf('Leicester'),
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

  it('records the reconciliation and court-context components in the detector version', async () => {
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => [],
      log: () => undefined,
    })

    const result = await detect('Synthetic text')

    expect(result.detectorVersion).toContain(';reconcile@1;court-context@1;')
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

  it('detects a document at the old limit in one pass so its spans are unchanged', async () => {
    const email = 'jane@example.com'
    const emailAt = 100_000
    const text =
      'x'.repeat(emailAt) +
      ` ${email} ` +
      'x'.repeat(DETECTION_WINDOW_CHARS - emailAt - email.length - 2)
    let calls = 0
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async () => {
        calls++
        return []
      },
      log: () => undefined,
    })

    const result = await detect(text)

    expect(text.length).toBe(DETECTION_WINDOW_CHARS)
    expect(calls).toBe(1)
    expect(
      result.spans.map(({ start, end, category }) => [start, end, category]),
    ).toEqual([[emailAt + 1, emailAt + 1 + email.length, 'email']])
  })

  it('detects every entity once at its document offsets across window boundaries', async () => {
    const length = 450_000
    const placed: Array<[number, string]> = [
      [199_995, 'ZQXWV00001'],
      [198_000, 'ZQXWV00002'],
      [395_990, 'ZQXWV00003'],
      [396_000, 'ZQXWV00004'],
    ]
    let text = 'x'.repeat(length)
    for (const [start, marker] of placed)
      text = text.slice(0, start) + marker + text.slice(start + marker.length)

    const windows = planDetectionWindows(text)
    const inputs: string[] = []
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => {
        inputs.push(masked)
        return [...masked.matchAll(/ZQXWV\d{5}/g)].map((match) => ({
          start: match.index,
          end: match.index + match[0].length,
          label: 'PASSPORT',
          score: 0.99,
          source: 'ner',
          text: match[0],
        }))
      },
      log: () => undefined,
    })

    const result = await detect(text)

    expect(windows.length).toBe(3)
    expect(inputs).toHaveLength(windows.length)
    for (const input of inputs)
      expect(input.length).toBeLessThanOrEqual(DETECTION_WINDOW_CHARS)
    expect(
      result.spans.map(({ start, end, text: spanText }) => [
        start,
        end,
        spanText,
      ]),
    ).toEqual(
      [...placed]
        .sort(([left], [right]) => left - right)
        .map(([start, marker]) => [start, start + marker.length, marker]),
    )
  })

  it('reports degraded detection when any window loses the model', async () => {
    const text = `ZQXWV99999${'x'.repeat(DETECTION_WINDOW_CHARS + 1_000)}`
    const detect = createRedactionDetector({
      loadClassifier: async () => classifier,
      detectNer: async (masked) => {
        if (masked.includes('ZQXWV99999'))
          throw new Error('window inference failed')
        return []
      },
      log: () => undefined,
    })

    const result = await detect(text)

    expect(result.degraded).toBe(true)
    expect(result.detectorVersion).toContain('mode=heuristics+supplement')
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
