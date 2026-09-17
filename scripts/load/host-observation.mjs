/*
 * Host and API resource observation for the load harness.
 *
 * The API runs as a systemd user unit, so cgroup v2 gives per-unit memory and
 * CPU without attaching to the process. `memory.stat`'s `anon` is the closest
 * thing to the unit's RSS; `memory.current` still carries the storage page
 * cache and is kept separately so a rising cache is not read as a leak.
 *
 * Every parsing function is exported and pure so the arithmetic is unit-tested
 * against captured `/proc` text rather than trusted from a live read.
 */
import { readFile, statfs } from 'node:fs/promises'

export function parseMeminfo(text) {
  const match = text.match(/^MemAvailable:\s+(\d+) kB$/m)
  return match ? Number(match[1]) * 1024 : null
}

export function parseAnon(statText) {
  const match = statText.match(/^anon\s+(\d+)$/m)
  return match ? Number(match[1]) : null
}

export function parseUsageUsec(cpuStatText) {
  const match = cpuStatText.match(/^usage_usec\s+(\d+)$/m)
  return match ? Number(match[1]) : null
}

/**
 * Aggregate host CPU ticks from /proc/stat. Load average counts runnable and
 * blocked tasks, so it cannot say whether the box was actually busy; the delta
 * between two reads can.
 */
export function parseHostCpu(text) {
  const match = text.match(
    /^cpu\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m,
  )
  if (!match) return null
  const ticks = match.slice(1, 8).map(Number)
  return {
    total: ticks.reduce((sum, value) => sum + value, 0),
    idle: ticks[3] + ticks[4],
  }
}

export async function hostCpuTicks(read = readFile, path = '/proc/stat') {
  return parseHostCpu(await read(path, 'utf8'))
}

/** Busy fraction between two host CPU readings, or null if either is missing. */
export function busyFraction(before, after) {
  if (!before || !after) return null
  const total = after.total - before.total
  if (!(total > 0)) return null
  const busy = total - (after.idle - before.idle)
  return Math.round((busy / total) * 1000) / 1000
}

/**
 * Resolve the cgroup directory that owns the lane's API unit. Uses systemd
 * rather than the process tree: the unit starts `pnpm → tsx → node`, and the
 * cgroup is the one identity that covers every process in it.
 */
export async function resolveUnitCgroup(unitName, { execFile } = {}) {
  const run = execFile ?? (await import('node:child_process')).execFile
  const controlGroup = await new Promise((resolve, reject) => {
    run(
      'systemctl',
      ['--user', 'show', '-p', 'ControlGroup', '--value', unitName],
      { encoding: 'utf8' },
      (error, stdout) =>
        error ? reject(error) : resolve(String(stdout).trim()),
    )
  })
  if (!controlGroup.startsWith('/'))
    throw new Error(
      `${unitName} is not running (systemd reported ControlGroup "${controlGroup}").`,
    )
  return `/sys/fs/cgroup${controlGroup}`
}

/**
 * One observer per run. `readFile`/`statfs` are injectable so tests can point
 * it at captured fixtures instead of the live host.
 */
export function createHostObserver({
  cgroupPath,
  meminfoPath = '/proc/meminfo',
  diskPath = '/',
  read = readFile,
  stat = statfs,
  now = () => Date.now(),
} = {}) {
  async function sample() {
    const [meminfo, statText, cpuStat, current, fs] = await Promise.all([
      read(meminfoPath, 'utf8'),
      read(`${cgroupPath}/memory.stat`, 'utf8'),
      read(`${cgroupPath}/cpu.stat`, 'utf8'),
      read(`${cgroupPath}/memory.current`, 'utf8'),
      stat(diskPath),
    ])

    return {
      atMs: now(),
      apiAnonBytes: parseAnon(statText),
      apiMemoryCurrentBytes: Number(current.trim()),
      apiCpuUsec: parseUsageUsec(cpuStat),
      hostAvailableBytes: parseMeminfo(meminfo),
      diskFreeBytes: fs.bavail * fs.bsize,
    }
  }

  return { sample }
}

/**
 * CPU and memory for an arbitrary unit cgroup. Used to describe what else was
 * running during the measurement window: another lane on the same 4 vCPUs
 * invalidates a capacity number, so the report has to say whether it happened.
 */
export async function readUnitUsage(cgroupPath, { read = readFile } = {}) {
  const [cpuStat, current] = await Promise.all([
    read(`${cgroupPath}/cpu.stat`, 'utf8'),
    read(`${cgroupPath}/memory.current`, 'utf8'),
  ])
  return {
    cpuUsec: parseUsageUsec(cpuStat),
    memoryCurrentBytes: Number(current.trim()),
  }
}

/**
 * Growth between a baseline and the peak sample, in the units the abort
 * bounds are stated in. `null` when a reading was unavailable, so a missing
 * metric can never be silently treated as zero growth.
 */
export function resourceSummary(baseline, samples) {
  const numeric = (value) => (typeof value === 'number' ? value : null)
  const peak = (key) => {
    const values = samples
      .map((entry) => numeric(entry[key]))
      .filter((v) => v !== null)
    return values.length === 0 ? null : Math.max(...values)
  }
  const low = (key) => {
    const values = samples
      .map((entry) => numeric(entry[key]))
      .filter((v) => v !== null)
    return values.length === 0 ? null : Math.min(...values)
  }

  const anonPeak = peak('apiAnonBytes')
  const cpuPeak = peak('apiCpuUsec')
  const baselineAnon = baseline ? numeric(baseline.apiAnonBytes) : null
  const baselineCpu = baseline ? numeric(baseline.apiCpuUsec) : null
  return {
    sampleCount: samples.length,
    apiAnonBaselineBytes: baselineAnon,
    apiAnonPeakBytes: anonPeak,
    apiAnonGrowthBytes:
      baselineAnon !== null && anonPeak !== null
        ? anonPeak - baselineAnon
        : null,
    apiCpuUsecBaseline: baselineCpu,
    apiCpuUsecPeak: cpuPeak,
    apiCpuUsecDelta:
      baselineCpu !== null && cpuPeak !== null ? cpuPeak - baselineCpu : null,
    hostAvailableMinBytes: low('hostAvailableBytes'),
    diskFreeMinBytes: low('diskFreeBytes'),
  }
}

export function activeObiterUnits() {
  try {
    return execFileSync(
      'systemctl',
      [
        '--user',
        'list-units',
        'obiter*',
        '--state',
        'running',
        '--no-legend',
        '--plain',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * The other Obiter units running on the box. Another lane on the same four
 * vCPUs invalidates a capacity number, so the window has to be described, not
 * assumed clean.
 */
export async function neighbourUsage(ownUnitName) {
  const neighbours = []
  for (const name of activeObiterUnits().filter(
    (unit) => unit !== ownUnitName,
  )) {
    try {
      const cgroupPath = await resolveUnitCgroup(name)
      neighbours.push({
        name,
        cgroupPath,
        usage: await readUnitUsage(cgroupPath),
      })
    } catch {
      // A unit that stopped between listing and reading is simply not there;
      // leaving it out is accurate and nothing else is inferred from it.
    }
  }
  return neighbours
}

function round(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value * 100) / 100
    : null
}

export function neighbourReport(before, after) {
  return before.map((entry) => {
    const later = after.find((candidate) => candidate.name === entry.name)
    const cpuUsec = entry.usage.cpuUsec
    const laterUsec = later?.usage.cpuUsec
    const delta =
      typeof cpuUsec === 'number' && typeof laterUsec === 'number'
        ? laterUsec - cpuUsec
        : null
    return {
      name: entry.name,
      // A negative delta means the unit restarted and its cgroup counter was
      // reset; that is an unknown window, never a negative or a zero one.
      cpuMsDuringWindow:
        delta !== null && delta >= 0 ? round(delta / 1000) : null,
      counterReset: delta !== null && delta < 0,
      memoryCurrentBytesBefore: entry.usage.memoryCurrentBytes,
      memoryCurrentBytesAfter: later?.usage.memoryCurrentBytes ?? null,
    }
  })
}

/**
 * Neighbour units over the busy threshold. Pure, so the rule that decides a
 * measurement window is unusable is tested rather than trusted.
 */
export function contendedUnits(before, after, maxCpuMs) {
  return neighbourReport(before, after).filter(
    (entry) => (entry.cpuMsDuringWindow ?? 0) > maxCpuMs,
  )
}

/**
 * Refuse to measure on a box another lane is using. The whole-window figure is
 * reported afterwards too, but a build that starts midway through a run cannot
 * be detected up front — it can only be seen in the result and rejected there.
 */
export async function assertNeighboursQuiet({
  unitName,
  before,
  windowMs,
  maxCpuMs,
}) {
  await new Promise((resolve) => setTimeout(resolve, windowMs))
  const busy = contendedUnits(
    before,
    await neighbourUsage(`${unitName}.service`),
    maxCpuMs,
  )
  if (busy.length > 0)
    throw new TargetRefusal(
      'neighbour_lane_busy',
      'Refusing to measure while another Obiter unit is working: ' +
        busy
          .map(
            (entry) =>
              `${entry.name} used ${entry.cpuMsDuringWindow} ms of CPU in ${windowMs} ms`,
          )
          .join(', ') +
        '. Re-run when the box is quiet; contended numbers do not describe this lane.',
    )
}
