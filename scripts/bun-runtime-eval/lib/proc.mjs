/*
 * Process-tree accounting, from /proc only (no ps dependency).
 *
 * Every measured server is started detached, so its pid is also its process
 * group id. A runtime that wraps the real server (tsx) is therefore measured
 * as a tree: RSS summed, CPU summed. Attributing only the wrapper's memory to
 * the runtime would flatter it by roughly a third.
 *
 * Peak memory is reported two ways and the distinction is deliberate:
 *
 *   - `peakSampledRssKb` is the largest value a sampler actually observed;
 *   - `sampling` records the interval, how many observations were taken and
 *     the largest process-tree size seen, so a reader can see how much of the
 *     sweep the sampler covered.
 *
 * Neither is a guaranteed maximum. A short allocation between two samples is
 * invisible, so the report never calls this "peak RSS" without the qualifier.
 */
import { readFile, readdir } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'

/** Pids in one process group, via /proc/<pid>/stat field 5. */
export async function groupPids(pgid) {
  const pids = []
  for (const entry of await readdir('/proc')) {
    if (!/^[0-9]+$/.test(entry)) continue
    try {
      const stat = await readFile(`/proc/${entry}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      if (Number(fields[2]) === pgid) pids.push(Number(entry))
    } catch {
      // Process exited between readdir and read.
    }
  }
  return pids
}

/** RSS (KiB) and cumulative CPU (ms) for one pid, from /proc. */
export async function sampleProcess(pid) {
  try {
    const statm = await readFile(`/proc/${pid}/statm`, 'utf8')
    const rssKb = (Number(statm.split(' ')[1]) * 4096) / 1024
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    const cpuMs = (Number(fields[11]) + Number(fields[12])) * 10
    return { rssKb, cpuMs }
  } catch {
    return { rssKb: null, cpuMs: null }
  }
}

/** RSS and cumulative CPU summed over the whole process group. */
export async function sampleTree(pgid) {
  const pids = await groupPids(pgid)
  let rssKb = 0
  let cpuMs = 0
  for (const pid of pids) {
    const sample = await sampleProcess(pid)
    if (sample.rssKb) rssKb += sample.rssKb
    if (sample.cpuMs) cpuMs += sample.cpuMs
  }
  return { rssKb: rssKb === 0 ? null : rssKb, cpuMs, pids: pids.length }
}

/**
 * Sample a process tree on a fixed interval for as long as it runs.
 *
 * `start()` returns immediately with a handle; `stop()` resolves with the
 * observations. The observed interval is measured from the first to the last
 * observation and divided by the gaps, so the report states what was actually
 * sampled rather than what was requested.
 */
export function startTreeSampler(pgid, { intervalMs = 250 } = {}) {
  const samples = []
  let timer = null
  let stopped = false

  const take = async () => {
    const tree = await sampleTree(pgid)
    samples.push({
      atMs: Math.round(performance.now()),
      rssKb: tree.rssKb,
      cpuMs: tree.cpuMs,
      pids: tree.pids,
    })
  }

  return {
    start() {
      void take()
      timer = setInterval(() => {
        if (!stopped) void take()
      }, intervalMs)
      timer.unref?.()
      return this
    },
    async stop() {
      stopped = true
      if (timer) clearInterval(timer)
      await take()
      return summariseSamples(samples, intervalMs)
    },
  }
}

function summariseSamples(samples, requestedIntervalMs) {
  const withRss = samples.filter((sample) => sample.rssKb)
  const peakSampledRssKb = withRss.reduce(
    (max, sample) => Math.max(max, sample.rssKb),
    0,
  )
  const maxTreePids = samples.reduce(
    (max, sample) => Math.max(max, sample.pids ?? 0),
    0,
  )
  const elapsedMs =
    samples.length > 1 ? samples[samples.length - 1].atMs - samples[0].atMs : 0
  return {
    requestedIntervalMs,
    observedIntervalMs:
      samples.length > 1 ? Math.round(elapsedMs / (samples.length - 1)) : null,
    observations: samples.length,
    coveredMs: elapsedMs,
    peakSampledRssKb: peakSampledRssKb === 0 ? null : peakSampledRssKb,
    maxTreePids,
    series: withRss.map((sample) => ({
      atMs: sample.atMs,
      rssMb: Math.round((sample.rssKb / 1024) * 10) / 10,
    })),
  }
}
