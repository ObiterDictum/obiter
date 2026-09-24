import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'bun:test'
import { vi } from '../test/vitest-compat'
import {
  UsageError,
  assertOutPathOutsideCheckout,
  buildCells,
  parseArgs,
} from './plan.mjs'
import { main } from './upload-extraction-load.mjs'
import { WORKTREE_ROOT } from '../../apps/web/lane-target.mjs'
import { contendedUnits, neighbourReport } from './host-observation.mjs'
import {
  DEFAULT_MAX_FIXTURE_BYTES,
  FixtureError,
  assertFixtureBounds,
  parseFixtureManifest,
} from './fixtures.mjs'
import {
  busyFraction,
  parseAnon,
  parseHostCpu,
  parseMeminfo,
  parseUsageUsec,
  resourceSummary,
} from './host-observation.mjs'

describe('buildCells', () => {
  it('produces the size × concurrency product in escalation order', () => {
    const cells = buildCells({
      sizes: ['small', 'medium'],
      ramp: [2, 1],
      requests: 4,
      durationMs: 5000,
    })
    expect(cells.map((cell) => `${cell.size}:${cell.concurrency}`)).toEqual([
      'small:1',
      'small:2',
      'medium:1',
      'medium:2',
    ])
  })

  it('refuses concurrency above the bound this slice is allowed to run', () => {
    expect(() =>
      buildCells({
        sizes: ['small'],
        ramp: [8],
        requests: 1,
        durationMs: 5000,
      }),
    ).toThrow(/out of range/)
    expect(() =>
      buildCells({
        sizes: ['small'],
        ramp: [0],
        requests: 1,
        durationMs: 5000,
      }),
    ).toThrow(UsageError)
  })

  it('refuses a request count or duration outside the bounded range', () => {
    expect(() =>
      buildCells({
        sizes: ['small'],
        ramp: [1],
        requests: 0,
        durationMs: 5000,
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildCells({
        sizes: ['small'],
        ramp: [1],
        requests: 65,
        durationMs: 5000,
      }),
    ).toThrow(UsageError)
    expect(() =>
      buildCells({ sizes: ['small'], ramp: [1], requests: 1, durationMs: 10 }),
    ).toThrow(UsageError)
  })

  it('refuses a plan larger than the cell bound for one run', () => {
    expect(() =>
      buildCells({
        sizes: ['a', 'b', 'c'],
        ramp: [1, 2, 4],
        requests: 1,
        durationMs: 5000,
      }),
    ).toThrow(/cell bound/)
  })

  it('refuses a plan with no cells at all', () => {
    expect(() =>
      buildCells({ sizes: [], ramp: [1], requests: 1, durationMs: 5000 }),
    ).toThrow(UsageError)
  })
})

describe('parseArgs', () => {
  it('defaults to a bounded two-cell escalation', () => {
    const options = parseArgs([])
    expect(options.sizes).toEqual(['small', 'medium'])
    expect(options.ramp).toEqual([1, 2])
    expect(options.bounds.minAvailableMb).toBeGreaterThan(0)
  })

  it('accepts a single concurrency instead of a ramp', () => {
    expect(parseArgs(['--concurrency', '4']).ramp).toEqual([4])
  })

  it('applies bound overrides', () => {
    const options = parseArgs([
      '--max-p95-ms',
      '1234',
      '--min-available-mb',
      '512',
    ])
    expect(options.bounds.maxP95Ms).toBe(1234)
    expect(options.bounds.minAvailableMb).toBe(512)
  })

  it('refuses an unknown argument rather than ignoring it', () => {
    expect(() => parseArgs(['--ramp-fast'])).toThrow(UsageError)
    expect(() => parseArgs(['stray'])).toThrow(UsageError)
  })

  it('refuses a flag with no value', () => {
    expect(() => parseArgs(['--sizes'])).toThrow(/needs a value/)
  })
})

describe('contention guard', () => {
  const neighbour = (name, cpuUsec, memory = 1) => ({
    name,
    cgroupPath: `/sys/fs/cgroup/${name}`,
    usage: { cpuUsec, memoryCurrentBytes: memory },
  })

  it('ignores a neighbour that is idle', () => {
    expect(
      contendedUnits(
        [neighbour('obiter-api.service', 1_000)],
        [neighbour('obiter-api.service', 1_050)],
        1000,
      ),
    ).toEqual([])
  })

  it('flags a neighbour that burned CPU during the window', () => {
    const busy = contendedUnits(
      [neighbour('obiter-lane-editor-api.service', 1_000_000)],
      [neighbour('obiter-lane-editor-api.service', 27_579_000)],
      1000,
    )
    expect(busy).toHaveLength(1)
    expect(busy[0].name).toBe('obiter-lane-editor-api.service')
    expect(busy[0].cpuMsDuringWindow).toBeCloseTo(26_579, 0)
  })

  it('treats a counter reset as unknown, not as negative or zero CPU', () => {
    const [entry] = neighbourReport(
      [neighbour('obiter-lane-editor-api.service', 26_000_000)],
      [neighbour('obiter-lane-editor-api.service', 5_000_000)],
    )
    expect(entry.cpuMsDuringWindow).toBeNull()
    expect(entry.counterReset).toBe(true)
    expect(
      contendedUnits(
        [neighbour('obiter-lane-editor-api.service', 26_000_000)],
        [neighbour('obiter-lane-editor-api.service', 5_000_000)],
        1000,
      ),
    ).toEqual([])
  })

  it('reports a missing reading as unknown rather than as idle', () => {
    const [entry] = neighbourReport(
      [neighbour('obiter-api.service', null)],
      [neighbour('obiter-api.service', null)],
    )
    expect(entry.cpuMsDuringWindow).toBeNull()
    // Unknown is not evidence of contention, and it is not evidence of a quiet
    // box either: the report keeps it null so a reader can tell the difference.
    expect(
      contendedUnits([neighbour('obiter-api.service', null)], [], 1000),
    ).toEqual([])
  })
})

describe('report path guard', () => {
  it('refuses a report inside the checkout', () => {
    expect(() =>
      assertOutPathOutsideCheckout(
        '/work/lane-security/report.json',
        '/work/lane-security',
      ),
    ).toThrow(/inside the checkout/)
  })

  it('allows a scratch path', () => {
    expect(
      assertOutPathOutsideCheckout('/tmp/q3.json', '/work/lane-security'),
    ).toBe('/tmp/q3.json')
  })
})

describe('fixture manifest', () => {
  const manifest = JSON.stringify([
    {
      size: 'small',
      path: '/tmp/small.docx',
      bytes: 47097,
      sha256: 'a'.repeat(64),
      paragraphs: 40,
    },
  ])

  it('parses and shape-checks the generator output', () => {
    expect(parseFixtureManifest(manifest, { sizes: ['small'] })).toEqual([
      {
        size: 'small',
        path: '/tmp/small.docx',
        bytes: 47097,
        sha256: 'a'.repeat(64),
        paragraphs: 40,
      },
    ])
  })

  it('refuses output that is not a manifest', () => {
    expect(() =>
      parseFixtureManifest('Traceback...', { sizes: ['small'] }),
    ).toThrow(FixtureError)
    expect(() => parseFixtureManifest('{}', { sizes: ['small'] })).toThrow(
      FixtureError,
    )
  })

  it('refuses a manifest missing a requested size or a field', () => {
    expect(() => parseFixtureManifest(manifest, { sizes: ['large'] })).toThrow(
      /no "large"/,
    )
    expect(() =>
      parseFixtureManifest('[{"size":"small"}]', { sizes: ['small'] }),
    ).toThrow(/missing "path"/)
  })

  it('refuses a fixture above the run bound', () => {
    expect(() =>
      assertFixtureBounds([{ size: 'large', bytes: 20 * 1024 * 1024 }], {
        maxBytes: DEFAULT_MAX_FIXTURE_BYTES,
      }),
    ).toThrow(/over the/)
  })

  it('refuses a bound above the API multipart cap', () => {
    expect(() =>
      assertFixtureBounds([], { maxBytes: 64 * 1024 * 1024 }),
    ).toThrow(/multipart cap/)
  })
})

describe('host observation parsing', () => {
  it('reads MemAvailable in bytes', () => {
    expect(parseMeminfo('MemTotal: 100 kB\nMemAvailable: 2048 kB\n')).toBe(
      2048 * 1024,
    )
    expect(parseMeminfo('MemTotal: 100 kB\n')).toBeNull()
  })

  it('reads the cgroup anon figure and CPU usage', () => {
    expect(parseAnon('anon 12345\nfile 7\n')).toBe(12345)
    expect(parseUsageUsec('usage_usec 987\nuser_usec 1\n')).toBe(987)
  })

  it('reports null growth when a reading is missing rather than zero', () => {
    const summary = resourceSummary({ apiAnonBytes: null, apiCpuUsec: null }, [
      { apiAnonBytes: 100, hostAvailableBytes: 10, diskFreeBytes: 10 },
    ])
    expect(summary.apiAnonGrowthBytes).toBeNull()
    expect(summary.apiCpuUsecDelta).toBeNull()
    expect(summary.apiAnonPeakBytes).toBe(100)
  })

  it('reports peak and minimum across the sampled window', () => {
    const summary = resourceSummary({ apiAnonBytes: 100, apiCpuUsec: 10 }, [
      {
        apiAnonBytes: 300,
        apiCpuUsec: 40,
        hostAvailableBytes: 900,
        diskFreeBytes: 500,
      },
      {
        apiAnonBytes: 200,
        apiCpuUsec: 30,
        hostAvailableBytes: 700,
        diskFreeBytes: 400,
      },
    ])
    expect(summary.apiAnonGrowthBytes).toBe(200)
    expect(summary.apiCpuUsecDelta).toBe(30)
    expect(summary.hostAvailableMinBytes).toBe(700)
    expect(summary.diskFreeMinBytes).toBe(400)
  })
})

describe('host CPU utilisation', () => {
  it('parses the aggregate cpu line', () => {
    const parsed = parseHostCpu(
      'cpu  100 0 50 800 50 0 0 0\ncpu0 1 0 1 8 1 0 0 0\n',
    )
    expect(parsed).not.toBeNull()
    expect(parsed.total).toBe(1000)
    expect(parsed.idle).toBe(850)
  })

  it('returns null rather than zero for an unreadable sample', () => {
    expect(parseHostCpu('intr 1\n')).toBeNull()
    expect(busyFraction(null, { total: 100, idle: 90 })).toBeNull()
    expect(
      busyFraction({ total: 10, idle: 5 }, { total: 10, idle: 5 }),
    ).toBeNull()
  })

  it('computes the busy share of the window', () => {
    expect(
      busyFraction({ total: 0, idle: 0 }, { total: 1000, idle: 250 }),
    ).toBe(0.75)
  })
})

const scratch = await mkdtemp(join(tmpdir(), 'q3-cli-test-'))
afterAll(() => rm(scratch, { recursive: true, force: true }))

describe('refusal reporting', () => {
  function recorder() {
    const written = []
    return {
      written,
      writeReport: async (path, contents) => {
        written.push({ path, contents })
      },
    }
  }

  it('writes a truthful refusal report for an argument refusal', async () => {
    const { written, writeReport } = recorder()
    await expect(
      main({
        argv: ['--out', '/tmp/q3-refusal.json', '--ramp', '8'],
        writeReport,
      }),
    ).rejects.toThrow(/out of range/)

    expect(written).toHaveLength(1)
    const report = JSON.parse(written[0].contents)
    expect(report.refused).toBe(true)
    expect(report.reason).toMatch(/out of range/)
  })

  it('writes a refusal report when the target is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'q3-target-refusal-'))
    const { written, writeReport } = recorder()
    await expect(
      main({
        argv: [
          '--out',
          join(scratch, 'target-refusal.json'),
          '--expect-checkout',
          root,
          // Skips the git lookup in `headSha`, which a scratch directory is
          // not and which would only add stderr noise.
          '--expect-commit',
          'deadbeef',
        ],
        writeReport,
      }),
    ).rejects.toThrow()

    expect(written).toHaveLength(1)
    const report = JSON.parse(written[0].contents)
    expect(report.refused).toBe(true)
    expect(report.reason.length).toBeGreaterThan(0)
    await rm(root, { recursive: true, force: true })
  })

  it('writes no report when --out is missing or unsafe', async () => {
    const { written, writeReport } = recorder()
    await expect(main({ argv: [], writeReport })).rejects.toThrow(/--out/)
    await expect(
      main({
        argv: ['--out', join(WORKTREE_ROOT, 'report.json')],
        writeReport,
      }),
    ).rejects.toThrow(/inside the checkout/)
    expect(written).toEqual([])
  })

  it('fails clearly on stderr when the report cannot be written', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {})
    // The refusal is still the failure the exit code reflects; the write
    // failure is surfaced on stderr rather than replacing it.
    await expect(
      main({
        argv: ['--out', '/tmp/q3-unwritable.json', '--ramp', '8'],
        writeReport: async () => {
          throw new Error('EACCES: permission denied')
        },
      }),
    ).rejects.toThrow(/out of range/)
    expect(reported).toHaveBeenCalledWith(
      expect.stringContaining('could not write the report'),
    )
    reported.mockRestore()
  })
})
