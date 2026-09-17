import { describe, expect, it } from 'vitest'
import {
  activeObiterUnits,
  assertNeighboursQuiet,
  contendedUnits,
  neighbourReport,
  neighbourUsage,
} from './host-observation.mjs'
import { TargetRefusal } from './target.mjs'

// Captured `systemctl --user list-units 'obiter*' --state running --no-legend
// --plain` output: three units, one of them the lane under test.
const SYSTEMCTL_OUTPUT = [
  'obiter-api.service               loaded active running Obiter API (shared dev server, port 8787)',
  'obiter-lane-editor-api.service   loaded active running Obiter lane editor API (port 8790)',
  'obiter-web.service               loaded active running Obiter web (shared dev server, port 3000)',
  '',
].join('\n')

const neighbour = (name, cpuUsec, memoryCurrentBytes = 1) => ({
  name,
  cgroupPath: `/sys/fs/cgroup/${name}`,
  usage: { cpuUsec, memoryCurrentBytes },
})

const quietWindow = { windowMs: 0, wait: async () => {} }

describe('activeObiterUnits', () => {
  it('reaches the systemctl boundary and parses the running unit names', () => {
    const calls = []
    const units = activeObiterUnits({
      exec: (command, args, options) => {
        calls.push({ command, args, options })
        return SYSTEMCTL_OUTPUT
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('systemctl')
    expect(calls[0].args).toEqual([
      '--user',
      'list-units',
      'obiter*',
      '--state',
      'running',
      '--no-legend',
      '--plain',
    ])
    expect(units).toEqual([
      'obiter-api.service',
      'obiter-lane-editor-api.service',
      'obiter-web.service',
    ])
  })

  it('refuses when the unit list cannot be read instead of reporting a quiet host', () => {
    expect(() =>
      activeObiterUnits({
        exec: () => {
          throw new Error('systemd is not answering')
        },
      }),
    ).toThrow(TargetRefusal)
  })
})

describe('neighbourUsage', () => {
  it('reads usage for the enumerated units other than this lane', async () => {
    const readPaths = []
    const usage = await neighbourUsage('obiter-lane-security-api.service', {
      listUnits: () => [
        'obiter-lane-security-api.service',
        'obiter-lane-editor-api.service',
      ],
      resolveCgroup: async (name) => `/sys/fs/cgroup/${name}`,
      readUsage: async (path) => {
        readPaths.push(path)
        return { cpuUsec: 10, memoryCurrentBytes: 20 }
      },
    })

    expect(usage.map((entry) => entry.name)).toEqual([
      'obiter-lane-editor-api.service',
    ])
    expect(readPaths).toEqual(['/sys/fs/cgroup/obiter-lane-editor-api.service'])
  })

  it('drops a unit that stopped between listing and reading rather than inventing usage', async () => {
    const usage = await neighbourUsage('obiter-lane-security-api.service', {
      listUnits: () => ['obiter-lane-editor-api.service'],
      resolveCgroup: async () => {
        const error = new Error('unit is not running')
        error.code = 'unit_not_running'
        throw error
      },
      readUsage: async () => ({ cpuUsec: 1, memoryCurrentBytes: 1 }),
    })

    expect(usage).toEqual([])
  })

  it('refuses when a listed neighbour’s usage cannot be read', async () => {
    await expect(
      neighbourUsage('obiter-lane-security-api.service', {
        listUnits: () => ['obiter-lane-editor-api.service'],
        resolveCgroup: async (name) => `/sys/fs/cgroup/${name}`,
        readUsage: async () => {
          const error = new Error('EACCES: permission denied')
          error.code = 'EACCES'
          throw error
        },
      }),
    ).rejects.toThrow(TargetRefusal)
  })
})

describe('assertNeighboursQuiet', () => {
  it('refuses before measurement when another unit burned CPU in the window', async () => {
    await expect(
      assertNeighboursQuiet({
        unitName: 'obiter-lane-security-api',
        before: [neighbour('obiter-lane-editor-api.service', 1_000_000)],
        maxCpuMs: 1000,
        after: async () => [
          neighbour('obiter-lane-editor-api.service', 27_000_000),
        ],
        ...quietWindow,
      }),
    ).rejects.toThrow(TargetRefusal)
  })

  it('refuses when a unit starts during the window even before its first sample', async () => {
    await expect(
      assertNeighboursQuiet({
        unitName: 'obiter-lane-security-api',
        before: [neighbour('obiter-api.service', 1_000)],
        maxCpuMs: 1000,
        after: async () => [
          neighbour('obiter-api.service', 1_100),
          neighbour('obiter-lane-editor-api.service', 9_000_000),
        ],
        ...quietWindow,
      }),
    ).rejects.toThrow(/obiter-lane-editor-api\.service/)
  })

  it('passes when no neighbour moved during the window', async () => {
    await expect(
      assertNeighboursQuiet({
        unitName: 'obiter-lane-security-api',
        before: [neighbour('obiter-api.service', 1_000)],
        maxCpuMs: 1000,
        after: async () => [neighbour('obiter-api.service', 1_050)],
        ...quietWindow,
      }),
    ).resolves.toBeUndefined()
  })
})

describe('neighbourReport over the whole window', () => {
  it('reports a unit that starts mid-window as appeared rather than invisible', () => {
    const [entry] = neighbourReport(
      [],
      [neighbour('obiter-lane-editor-api.service', 9_000_000)],
    )

    expect(entry).toMatchObject({
      name: 'obiter-lane-editor-api.service',
      cpuMsDuringWindow: null,
      appearedDuringWindow: true,
      disappearedDuringWindow: false,
    })
  })

  it('reports a unit that stops mid-window instead of dropping it', () => {
    const [entry] = neighbourReport(
      [neighbour('obiter-lane-editor-api.service', 9_000_000)],
      [],
    )

    expect(entry).toMatchObject({
      name: 'obiter-lane-editor-api.service',
      appearedDuringWindow: false,
      disappearedDuringWindow: true,
    })
  })

  it('counts a unit that starts mid-window as contention', () => {
    expect(
      contendedUnits(
        [],
        [neighbour('obiter-lane-editor-api.service', 1)],
        1000,
      ),
    ).toHaveLength(1)
  })
})
