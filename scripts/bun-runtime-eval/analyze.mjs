#!/usr/bin/env node
/*
 * Derive every published number from the raw measurement artifacts and emit
 * both the tables and an explicit artifact-to-table mapping.
 *
 * The point is traceability: a decision record whose figures cannot be
 * re-derived from a checksummed file is not evidence. This script takes the
 * checksummed JSON, produces the comparison tables, and records for each cell
 * which artifact file and which JSON path it came from. If a number in the
 * document is not in this output, it does not belong in the document.
 *
 *   node scripts/bun-runtime-eval/analyze.mjs \
 *     --campaign r2/paired-compiled-rounds3-n120.json \
 *     --out r2/derived-tables
 *
 * Options:
 *   --campaign <file>       a compare.mjs paired campaign (required)
 *   --historical-node <f>   a retained single-run compiled-node.json
 *   --historical-bun <f>    a retained single-run compiled-bun.json
 *   --out <prefix>          writes <prefix>.json and <prefix>.md (default stdout)
 */
import { readFile, writeFile } from 'node:fs/promises'

function parseArgs(argv) {
  const out = {
    campaign: null,
    historicalNode: null,
    historicalBun: null,
    out: null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--campaign') out.campaign = argv[++i]
    else if (key === '--historical-node') out.historicalNode = argv[++i]
    else if (key === '--historical-bun') out.historicalBun = argv[++i]
    else if (key === '--out') out.out = argv[++i]
    else throw new Error(`unknown argument ${key}`)
  }
  if (!out.campaign) throw new Error('--campaign is required')
  return out
}

const round2 = (value) =>
  value === null || value === undefined ? null : Math.round(value * 100) / 100

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2
}

function deltaPercent(candidate, baseline) {
  if (
    !Number.isFinite(candidate) ||
    !Number.isFinite(baseline) ||
    baseline === 0
  )
    return null
  return round2(((candidate - baseline) / baseline) * 100)
}

function runtimeScalars(report, runtime) {
  return (report.measured ?? []).filter((run) => run.runtime === runtime)
}

function summariseJourney(name, entries, baselineRuntime, candidateRuntime) {
  const byRuntime = {
    [baselineRuntime]: entries.filter(
      (entry) => entry.runtime === baselineRuntime,
    ),
    [candidateRuntime]: entries.filter(
      (entry) => entry.runtime === candidateRuntime,
    ),
  }
  const base = byRuntime[baselineRuntime].map((e) => e.journey.latency)
  const cand = byRuntime[candidateRuntime].map((e) => e.journey.latency)
  const baseP50 = median(base.map((latency) => latency?.p50))
  const candP50 = median(cand.map((latency) => latency?.p50))
  const baseP95 = median(base.map((latency) => latency?.p95))
  const candP95 = median(cand.map((latency) => latency?.p95))
  return {
    name,
    nPerRound: {
      [baselineRuntime]: base.map((latency) => latency?.count ?? 0),
      [candidateRuntime]: cand.map((latency) => latency?.count ?? 0),
    },
    p95IsMax: {
      [baselineRuntime]: base.map((latency) => latency?.p95IsMax ?? null),
      [candidateRuntime]: cand.map((latency) => latency?.p95IsMax ?? null),
    },
    perRound: {
      [baselineRuntime]: base.map((latency) => ({
        p50: latency?.p50,
        p95: latency?.p95,
        min: latency?.min,
        max: latency?.max,
      })),
      [candidateRuntime]: cand.map((latency) => ({
        p50: latency?.p50,
        p95: latency?.p95,
        min: latency?.min,
        max: latency?.max,
      })),
    },
    medianOfRounds: {
      [baselineRuntime]: { p50: round2(baseP50), p95: round2(baseP95) },
      [candidateRuntime]: { p50: round2(candP50), p95: round2(candP95) },
    },
    deltaP50Percent: deltaPercent(candP50, baseP50),
    deltaP95Percent: deltaPercent(candP95, baseP95),
  }
}

function scalarsTable(report, baselineRuntime, candidateRuntime, artifact) {
  const rows = []
  const metrics = [
    ['readyMs', 'ms'],
    ['idleRssMb', 'MB'],
    ['peakSampledRssMb', 'MB'],
    ['cpuMs', 'ms'],
    ['driverCpuMs', 'ms'],
  ]
  for (const [field, unit] of metrics) {
    const base = runtimeScalars(report, baselineRuntime).map(
      (run) => run[field],
    )
    const cand = runtimeScalars(report, candidateRuntime).map(
      (run) => run[field],
    )
    rows.push({
      metric: field,
      unit,
      artifact,
      jsonPath: `measured[?runtime==${baselineRuntime}].${field}`,
      [baselineRuntime]: { values: base, median: round2(median(base)) },
      [candidateRuntime]: { values: cand, median: round2(median(cand)) },
      deltaPercent: deltaPercent(median(cand), median(base)),
    })
  }
  return rows
}

function markdown(
  report,
  baselineRuntime,
  candidateRuntime,
  journeys,
  scalars,
) {
  const lines = []
  lines.push(`# Derived tables — ${report.mode} (${report.rows.join(' vs ')})`)
  lines.push('')
  lines.push(
    `Campaign commit \`${report.commit}\`, ${report.rounds} rounds, generated from the raw artifact.`,
  )
  lines.push('')
  lines.push(`## Scalars (median of rounds; per-round values in the JSON)`)
  lines.push('')
  lines.push(`| Metric | ${baselineRuntime} | ${candidateRuntime} | Delta |`)
  lines.push('| --- | --- | --- | --- |')
  for (const row of scalars) {
    lines.push(
      `| ${row.metric} (${row.unit}) | ${row[baselineRuntime].values.join(', ')} | ${row[candidateRuntime].values.join(', ')} | ${row.deltaPercent === null ? 'n/a' : `${row.deltaPercent}%`} |`,
    )
  }
  lines.push('')
  lines.push('## Journeys (median of per-round p50/p95)')
  lines.push('')
  lines.push(
    `| Journey | n/round ${baselineRuntime} | ${baselineRuntime} p50/p95 | n/round ${candidateRuntime} | ${candidateRuntime} p50/p95 | Δp50 | Δp95 |`,
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const journey of journeys) {
    const b = journey.nPerRound[baselineRuntime].join('/')
    const c = journey.nPerRound[candidateRuntime].join('/')
    const bm = journey.medianOfRounds[baselineRuntime]
    const cm = journey.medianOfRounds[candidateRuntime]
    lines.push(
      `| ${journey.name} | ${b} | ${bm.p50} / ${bm.p95} | ${c} | ${cm.p50} / ${cm.p95} | ${journey.deltaP50Percent}% | ${journey.deltaP95Percent}% |`,
    )
  }
  lines.push('')
  lines.push('## Per-round distributions')
  lines.push('')
  for (const journey of journeys) {
    lines.push(`### ${journey.name}`)
    lines.push('')
    lines.push(
      `| round | ${baselineRuntime} p50/p95/min/max | ${candidateRuntime} p50/p95/min/max |`,
    )
    lines.push('| --- | --- | --- |')
    const rounds = Math.max(
      journey.perRound[baselineRuntime].length,
      journey.perRound[candidateRuntime].length,
    )
    for (let i = 0; i < rounds; i += 1) {
      const b = journey.perRound[baselineRuntime][i]
      const c = journey.perRound[candidateRuntime][i]
      const fmt = (entry) =>
        entry ? `${entry.p50}/${entry.p95}/${entry.min}/${entry.max}` : '—'
      lines.push(`| ${i + 1} | ${fmt(b)} | ${fmt(c)} |`)
    }
    lines.push('')
    lines.push(
      `p95-is-max flags: ${baselineRuntime} [${journey.p95IsMax[baselineRuntime].join(', ')}], ${candidateRuntime} [${journey.p95IsMax[candidateRuntime].join(', ')}]`,
    )
    lines.push('')
  }
  return lines.join('\n')
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const campaign = await loadJson(args.campaign)
  const [baselineRuntime, candidateRuntime] = campaign.rows

  // Every measured journey, in first-seen order.
  const names = []
  for (const run of campaign.measured ?? []) {
    for (const journey of run.journeys)
      if (!names.includes(journey.name)) names.push(journey.name)
  }
  const entries = []
  for (const name of names) {
    for (const run of campaign.measured ?? []) {
      const journey = run.journeys.find((candidate) => candidate.name === name)
      if (journey)
        entries.push({
          name,
          runtime: run.runtime,
          round: run.round,
          order: run.order,
          journey,
        })
    }
  }
  const journeys = names.map((name) =>
    summariseJourney(
      name,
      entries.filter((entry) => entry.name === name),
      baselineRuntime,
      candidateRuntime,
    ),
  )
  const scalars = scalarsTable(
    campaign,
    baselineRuntime,
    candidateRuntime,
    args.campaign,
  )

  const result = {
    artifact: args.campaign,
    baselineRuntime,
    candidateRuntime,
    rounds: campaign.rounds,
    commit: campaign.commit,
    journeyCounts: campaign.journeyCounts,
    rssIntervalMs: campaign.rssIntervalMs,
    quietWindow: campaign.quietWindow,
    journeys,
    scalars,
    // Explicit mapping: every published table cell names the raw file and the
    // JSON path it was read from.
    artifactToTable: [
      {
        table: 'scalars',
        artifact: args.campaign,
        jsonPath:
          'measured[].{runtime,round,readyMs,idleRssMb,peakSampledRssMb,cpuMs,driverCpuMs}',
      },
      {
        table: 'journeys',
        artifact: args.campaign,
        jsonPath:
          'measured[].journeys[].{name,latency.p50,latency.p95,latency.count,latency.p95IsMax}',
      },
      {
        table: 'per-round-distributions',
        artifact: args.campaign,
        jsonPath: 'measured[].journeys[].latency.valuesMs',
      },
    ],
  }

  if (args.historicalNode || args.historicalBun) {
    result.historical = {}
    if (args.historicalNode) {
      const report = await loadJson(args.historicalNode)
      result.historical.node = {
        artifact: args.historicalNode,
        measured: report.measured,
      }
    }
    if (args.historicalBun) {
      const report = await loadJson(args.historicalBun)
      result.historical.bun = {
        artifact: args.historicalBun,
        measured: report.measured,
      }
    }
  }

  const text = markdown(
    campaign,
    baselineRuntime,
    candidateRuntime,
    journeys,
    scalars,
  )
  if (args.out) {
    await writeFile(`${args.out}.json`, JSON.stringify(result, null, 2), 'utf8')
    await writeFile(`${args.out}.md`, text, 'utf8')
    console.log(`wrote ${args.out}.json and ${args.out}.md`)
  } else {
    console.log(text)
  }
}

await main()
