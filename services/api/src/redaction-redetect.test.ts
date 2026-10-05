import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { Pool } from 'pg'

const database = vi.hoisted(() => ({
  getRedactionRun: vi.fn(),
  getRunTextObjectKey: vi.fn(),
}))
const creation = vi.hoisted(() => ({
  createRedetectionRun: vi.fn(),
  getRedetectionRun: vi.fn(),
}))
const detector = vi.hoisted(() => ({
  configureRedactionDetector: vi.fn(),
  detectRedactionSpans: vi.fn(),
}))

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const redactionDatabaseModuleKeys = Object.fromEntries(
  Object.keys(await import('./redaction-database')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./redaction-database', () =>
  Object.assign({ ...redactionDatabaseModuleKeys }, (() => database)()),
)
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const redactionRunCreationModuleKeys = Object.fromEntries(
  Object.keys(await import('./redaction-run-creation')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./redaction-run-creation', () =>
  Object.assign({ ...redactionRunCreationModuleKeys }, (() => creation)()),
)
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const redactionDetectionModuleKeys = Object.fromEntries(
  Object.keys(await import('./redaction-detection')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./redaction-detection', () =>
  Object.assign(
    { ...redactionDetectionModuleKeys },
    (() => ({
      configureRedactionDetector: detector.configureRedactionDetector,
      detectionMode: (degraded: boolean) =>
        degraded ? 'heuristics+supplement' : 'model+supplement',
      detectRedactionSpans: detector.detectRedactionSpans,
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { redetectRedactionRun } = await import('./redaction-redetect')

const sourceRun = {
  id: 'red_1',
  organisationId: 'org_1',
  matterId: null,
  detectionMode: 'heuristics+supplement',
}
const replacement = {
  id: 'red_2',
  organisationId: 'org_1',
  matterId: null,
  detectionMode: 'model+supplement',
  replacesRunId: 'red_1',
}

function storage() {
  return {
    readText: vi.fn(async (_key: string) => 'Exact stored source'),
    writeText: vi.fn(async (_key: string, _text: string) => undefined),
    delete: vi.fn(async (_key: string) => undefined),
  }
}

function input(store: ReturnType<typeof storage>) {
  return {
    pool: { query: vi.fn() } as unknown as Pool,
    storage: store,
    organisationId: 'org_1',
    userId: 'usr_1',
    runId: 'red_1',
    requestId: 'req_1',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  database.getRedactionRun.mockResolvedValue(sourceRun)
  database.getRunTextObjectKey.mockResolvedValue(
    'org/org_1/redaction-runs/red_1/source',
  )
  creation.getRedetectionRun.mockResolvedValue(null)
  detector.detectRedactionSpans.mockResolvedValue({
    spans: [],
    detectorVersion: 'detector-2;mode=model+supplement',
    degraded: false,
  })
  creation.createRedetectionRun.mockResolvedValue({
    kind: 'created',
    run: replacement,
  })
})

describe('redetectRedactionRun', () => {
  it('detects the exact stored source and stages an independent standalone object', async () => {
    const store = storage()

    await expect(redetectRedactionRun(input(store))).resolves.toMatchObject({
      kind: 'created',
      run: replacement,
    })

    expect(detector.detectRedactionSpans).toHaveBeenCalledWith(
      'Exact stored source',
    )
    const stagedKey = store.writeText.mock.calls[0][0]
    expect(stagedKey).toMatch(
      /^org\/org_1\/redaction-runs\/red_[\w-]+\/source$/,
    )
    expect(store.writeText).toHaveBeenCalledWith(
      stagedKey,
      'Exact stored source',
    )
    expect(creation.createRedetectionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRunId: 'red_1',
        sourceTextObjectKey: stagedKey,
        detectionMode: 'model+supplement',
      }),
    )
    expect(store.delete).not.toHaveBeenCalled()
  })

  it('returns model_unavailable without creating a run when detection still degrades', async () => {
    detector.detectRedactionSpans.mockResolvedValueOnce({
      spans: [],
      detectorVersion: 'detector-2;mode=heuristics+supplement',
      degraded: true,
    })
    const store = storage()

    await expect(redetectRedactionRun(input(store))).resolves.toEqual({
      kind: 'model_unavailable',
    })

    expect(store.writeText).not.toHaveBeenCalled()
    expect(creation.createRedetectionRun).not.toHaveBeenCalled()
  })

  it('removes the staged object after a confirmed database rollback', async () => {
    creation.createRedetectionRun.mockRejectedValueOnce(
      new Error('audit unavailable'),
    )
    const store = storage()
    const request = input(store)

    await expect(redetectRedactionRun(request)).rejects.toThrow(
      'audit unavailable',
    )

    expect(creation.getRedetectionRun).toHaveBeenCalledWith(
      request.pool,
      'org_1',
      'usr_1',
      'red_1',
    )
    expect(store.delete).toHaveBeenCalledWith(store.writeText.mock.calls[0][0])
  })

  it('retains a staged object when an ambiguous commit produced the replacement', async () => {
    creation.createRedetectionRun.mockRejectedValueOnce(
      new Error('commit response lost'),
    )
    const store = storage()
    const persisted = {
      ...replacement,
      get sourceTextObjectKey() {
        return store.writeText.mock.calls[0][0]
      },
    }
    creation.getRedetectionRun
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persisted)

    await expect(redetectRedactionRun(input(store))).resolves.toEqual({
      kind: 'existing',
      run: persisted,
    })

    expect(store.delete).not.toHaveBeenCalled()
  })

  it('returns an existing replacement without reading storage or running detection', async () => {
    creation.getRedetectionRun.mockResolvedValueOnce(replacement)
    const store = storage()

    await expect(redetectRedactionRun(input(store))).resolves.toEqual({
      kind: 'existing',
      run: replacement,
    })

    expect(store.readText).not.toHaveBeenCalled()
    expect(detector.detectRedactionSpans).not.toHaveBeenCalled()
  })

  it('rejects a model-detected source before reading storage or running detection', async () => {
    database.getRedactionRun.mockResolvedValueOnce({
      ...sourceRun,
      detectionMode: 'model+supplement',
    })
    const store = storage()

    await expect(redetectRedactionRun(input(store))).resolves.toEqual({
      kind: 'already_model_detected',
    })

    expect(store.readText).not.toHaveBeenCalled()
    expect(detector.detectRedactionSpans).not.toHaveBeenCalled()
  })
})
