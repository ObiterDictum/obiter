import { execFileSync } from 'node:child_process'
import { readFile, statfs } from 'node:fs/promises'
import { TargetRefusal } from './target.mjs'

const UNIT_LIST_TIMEOUT_MS = 5000

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

export function busyFraction(before, after) {
  if (!before || !after) return null
  const total = after.total - before.total
  if (!(total > 0)) return null
  const busy = total - (after.idle - before.idle)
  return Math.round((busy / total) * 1000) / 1000
}

export async function resolveUnitCgroup(unitName, { execFile } = {}) {
  const run = execFile ?? (await import('node:child_process')).execFile
  const controlGroup = await new Promise((resolve, reject) => {
    run(
      'systemctl',
      ['--user', 'show', '-p', 'ControlGroup', '--value', unitName],
      { encoding: 'utf8', timeout: UNIT_LIST_TIMEOUT_MS },
      (error, stdout) =>
        error ? reject(error) : resolve(String(stdout).trim()),
    )
  })
  if (!controlGroup.startsWith('/'))
    throw Object.assign(
      new Error(
        `${unitName} is not running (systemd reported ControlGroup "${controlGroup}").`,
      ),
      { code: 'unit_not_running' },
    )
  return `/sys/fs/cgroup${controlGroup}`
}

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

export function activeObiterUnits({ exec = execFileSync } = {}) {
  let output
  try {
    output = exec(
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
      { encoding: 'utf8', timeout: UNIT_LIST_TIMEOUT_MS },
    )
  } catch (error) {
    throw new TargetRefusal(
      'neighbour_observation_failed',
      `Could not list the running Obiter units: ${error instanceof Error ? error.message : String(error)}. ` +
        'A host that cannot be shown quiet is not a quiet host, so the run is refused.',
    )
  }
  return String(output)
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
}

export async function neighbourUsage(
  ownUnitName,
  {
    listUnits = activeObiterUnits,
    resolveCgroup = resolveUnitCgroup,
    readUsage = readUnitUsage,
  } = {},
) {
  const neighbours = []
  for (const name of listUnits().filter((unit) => unit !== ownUnitName)) {
    try {
      const cgroupPath = await resolveCgroup(name)
      neighbours.push({ name, cgroupPath, usage: await readUsage(cgroupPath) })
    } catch (error) {
      if (
        error?.code === 'unit_not_running' ||
        error?.code === 'ENOENT' ||
        error?.code === 'ENOTDIR'
      )
        continue
      throw new TargetRefusal(
        'neighbour_observation_failed',
        `Could not read usage for ${name}: ${error instanceof Error ? error.message : String(error)}. ` +
          'The window cannot be shown quiet, so the run is refused.',
      )
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
  const names = [
    ...new Set([
      ...before.map((entry) => entry.name),
      ...after.map((entry) => entry.name),
    ]),
  ]
  return names.map((name) => {
    const earlier = before.find((entry) => entry.name === name) ?? null
    const later = after.find((entry) => entry.name === name) ?? null
    const cpuUsec = earlier?.usage.cpuUsec
    const laterUsec = later?.usage.cpuUsec
    const delta =
      typeof cpuUsec === 'number' && typeof laterUsec === 'number'
        ? laterUsec - cpuUsec
        : null
    return {
      name,
      cpuMsDuringWindow:
        delta !== null && delta >= 0 ? round(delta / 1000) : null,
      counterReset: delta !== null && delta < 0,
      appearedDuringWindow: earlier === null,
      disappearedDuringWindow: later === null,
      memoryCurrentBytesBefore: earlier?.usage.memoryCurrentBytes ?? null,
      memoryCurrentBytesAfter: later?.usage.memoryCurrentBytes ?? null,
    }
  })
}

export function contendedUnits(before, after, maxCpuMs) {
  return neighbourReport(before, after).filter(
    (entry) =>
      entry.appearedDuringWindow || (entry.cpuMsDuringWindow ?? 0) > maxCpuMs,
  )
}

export async function assertNeighboursQuiet({
  unitName,
  before,
  windowMs,
  maxCpuMs,
  after = () => neighbourUsage(`${unitName}.service`),
  wait = sleepFor,
}) {
  await wait(windowMs)
  const busy = contendedUnits(before, await after(), maxCpuMs)
  if (busy.length > 0)
    throw new TargetRefusal(
      'neighbour_lane_busy',
      'Refusing to measure while another Obiter unit is working: ' +
        busy
          .map((entry) =>
            entry.appearedDuringWindow
              ? `${entry.name} started during the window`
              : `${entry.name} used ${entry.cpuMsDuringWindow} ms of CPU in ${windowMs} ms`,
          )
          .join(', ') +
        '. Re-run when the box is quiet; contended numbers do not describe this lane.',
    )
}

function sleepFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
