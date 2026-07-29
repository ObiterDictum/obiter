import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { redetectRedactionRun } from './redaction-redetect'

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

vi.mock('./redaction-database', () => database)
vi.mock('./redaction-run-creation', () => creation)
vi.mock('./redaction-detection', () => ({
  configureRedactionDetector: detector.configureRedactionDetector,
  detectionMode: (degraded: boolean) =>
    degraded ? 'heuristics+supplement' : 'model+supplement',
  detectRedactionSpans: detector.detectRedactionSpans,
}))

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
