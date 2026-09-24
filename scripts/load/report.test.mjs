import { describe, expect, it } from 'bun:test'
import {
  EXIT_OK,
  EXIT_RUN_FAILED,
  buildReport,
  decideExitCode,
  refusalReport,
} from './report.mjs'

const options = { bounds: { probeIntervalMs: 250 }, checkOnly: false }

function cleanLoad(overrides = {}) {
  return {
    baselineResources: { apiAnonBytes: 1, apiCpuUsec: 1 },
    recoverySamples: [{ apiAnonBytes: 2, apiCpuUsec: 2 }],
    samplerErrors: 0,
    observationCount: 12,
    perCell: [{ accepted: true }],
    skipped: [],
    cancelled: false,
    probes: [],
    ...overrides,
  }
}

function cleanVerification(overrides = {}) {
  return {
    expectedReady: 12,
    documentCount: 12,
    versionCount: 12,
    readyCount: 12,
    failedCount: 0,
    readyMatchesExpected: true,
    allStoragePresent: true,
    documentsWithoutVersion: 0,
    readyWithoutTextKey: 0,
    duplicateDocumentIds: [],
    duplicateVersionNumbers: [],
    versionCountMatchesDocuments: true,
    auditMatchesExpected: true,
    auditExpected: {
      'document.upload': 12,
      'document.version_create': 12,
      'matter.create': 1,
    },
    ...overrides,
  }
}

const passIsolation = { allPassed: true, checks: [] }

function exitFor({
  load = {},
  verification = {},
  isolation = passIsolation,
  contended = false,
} = {}) {
  return decideExitCode({
    options,
    load: cleanLoad(load),
    verification: cleanVerification(verification),
    isolation,
    contended,
  })
}

describe('decideExitCode correctness observations', () => {
  it('accepts a clean run', () => {
    expect(exitFor()).toBe(EXIT_OK)
  })

  it('fails a run whose observer recorded no samples', () => {
    expect(exitFor({ load: { samplerErrors: 2 } })).toBe(EXIT_RUN_FAILED)
  })

  it('fails a run with no baseline or no successful sample at all', () => {
    expect(exitFor({ load: { baselineResources: null } })).toBe(EXIT_RUN_FAILED)
    expect(exitFor({ load: { observationCount: 0 } })).toBe(EXIT_RUN_FAILED)
  })

  it('fails a run whose audit rows do not match the expected shape', () => {
    expect(exitFor({ verification: { auditMatchesExpected: false } })).toBe(
      EXIT_RUN_FAILED,
    )
  })

  it('fails a run with a failed version', () => {
    expect(exitFor({ verification: { failedCount: 1 } })).toBe(EXIT_RUN_FAILED)
  })

  it('fails a run whose version or document counts do not match', () => {
    expect(exitFor({ verification: { versionCount: 13 } })).toBe(
      EXIT_RUN_FAILED,
    )
    expect(exitFor({ verification: { documentCount: 13 } })).toBe(
      EXIT_RUN_FAILED,
    )
  })

  it('fails a contended window even when everything else is clean', () => {
    expect(exitFor({ contended: true })).toBe(EXIT_RUN_FAILED)
  })
})

describe('buildReport observations', () => {
  function context({ load: loadOverrides, ...overrides } = {}) {
    const load = cleanLoad(loadOverrides)
    return {
      options,
      target: {
        apiOrigin: 'http://127.0.0.1:8791',
        health: {
          provenance: {
            checkoutRoot: '/work/lane-security',
            commitSha: 'abc123',
            envFile: '/work/lane-security/.env',
          },
        },
        databaseName: 'obiter_lane_security',
        databaseSource: 'lane-derived',
      },
      unitName: 'obiter-lane-security-api',
      worktreeRoot: '/work/lane-security',
      runTag: 'abc12345',
      cgroupPath:
        '/sys/fs/cgroup/obiter.slice/obiter-lane-security-api.service',
      baseline: load.baselineResources,
      cells: [],
      fixtures: [],
      preExistingVersions: 0,
      load,
      verification: cleanVerification(overrides.verification),
      isolation: passIsolation,
      neighbours: [],
      contended: false,
      hostLoad: { before: [0, 0, 0], after: [0, 0, 0] },
      loopDelay: { percentile: () => 0, max: 0 },
      cleanup: { softDeletedMatters: [], failed: false },
      activeUnits: ['obiter-api.service'],
      activeUnitsAfter: ['obiter-api.service'],
      ...overrides,
    }
  }

  it('records the sampler failure count and a degraded availability', () => {
    const report = buildReport(
      context({ load: { samplerErrors: 3, observationCount: 9 } }),
    )

    expect(report.observations).toMatchObject({
      availability: 'degraded',
      samplerErrors: 3,
      samples: 9,
    })
  })

  it('reports complete availability for a fully sampled run', () => {
    expect(buildReport(context()).observations.availability).toBe('complete')
  })

  it('lists the units captured for the run rather than re-reading systemctl', () => {
    const report = buildReport(
      context({
        activeUnits: ['obiter-api.service'],
        activeUnitsAfter: [],
      }),
    )

    expect(report.environment.activeObiterUnits).toEqual(['obiter-api.service'])
    expect(report.environment.activeObiterUnitsAfter).toEqual([])
  })
})

describe('refusalReport', () => {
  it('carries the refusal code and reason so a reader can tell why nothing ran', () => {
    const error = Object.assign(
      new Error(
        'Refusing to write fixtures into database "obiter_lane_search".',
      ),
      { code: 'database_not_this_lane', name: 'TargetRefusal' },
    )
    const report = refusalReport(error)

    expect(report.refused).toBe(true)
    expect(report.code).toBe('database_not_this_lane')
    expect(report.reason).toContain('obiter_lane_search')
  })

  it('redacts a credential from the refusal reason', () => {
    const error = new Error(
      'connect postgresql://obiter:s3cret@localhost:5432/db failed',
    )
    expect(refusalReport(error).reason).not.toContain('s3cret')
  })

  it('is still a truthful refusal report with no error attached', () => {
    expect(refusalReport()).toMatchObject({ refused: true, code: null })
  })
})
