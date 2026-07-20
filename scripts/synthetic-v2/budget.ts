import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SpendEntry, SpendLedger, Usage } from './types'

export type ModelPricing = {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
  cacheCreationUsdPerMillion?: number
  cacheReadUsdPerMillion?: number
  batchDiscount?: number
}

export type PricingTable = Record<string, ModelPricing>

export async function readLedger(
  path: string,
  capGbp = 30,
): Promise<SpendLedger> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as SpendLedger
  } catch (error) {
    if (isMissingFile(error)) return { capGbp, entries: [] }
    throw error
  }
}

export function costGbp(
  usage: Usage,
  pricing: ModelPricing,
  gbpPerUsd: number,
) {
  const usd =
    (usage.inputTokens * pricing.inputUsdPerMillion +
      usage.outputTokens * pricing.outputUsdPerMillion +
      pricedCacheTokens(
        usage.cacheCreationInputTokens ?? 0,
        pricing.cacheCreationUsdPerMillion,
        'cache creation',
      ) +
      pricedCacheTokens(
        usage.cacheReadInputTokens ?? 0,
        pricing.cacheReadUsdPerMillion,
        'cache read',
      )) /
    1_000_000
  return Number((usd * (pricing.batchDiscount ?? 1) * gbpPerUsd).toFixed(6))
}

export function cumulativeSpend(ledger: SpendLedger) {
  return ledger.entries.reduce((total, entry) => total + entry.gbp, 0)
}

export async function reserveSpend(
  path: string,
  ledger: SpendLedger,
  entry: Omit<SpendEntry, 'recordedAt' | 'state'>,
) {
  // Spend is recorded for model comparison and provenance. Stage selection,
  // rather than an implicit monetary cap, controls submission volume.
  ledger.entries.push({
    ...entry,
    state: 'reserved',
    recordedAt: new Date().toISOString(),
  })
  await writeLedger(path, ledger)
}

export async function reconcileSpend(
  path: string,
  ledger: SpendLedger,
  reservationId: string,
  entry: Omit<SpendEntry, 'recordedAt' | 'state' | 'reservationId'>,
) {
  const index = ledger.entries.findIndex(
    (candidate) =>
      candidate.state === 'reserved' &&
      candidate.reservationId === reservationId,
  )
  if (index === -1)
    throw new Error(`Spend reservation ${reservationId} is missing`)
  const reservedGbp = ledger.entries[index]!.gbp
  ledger.entries[index] = {
    ...entry,
    state: 'actual',
    reservationId,
    recordedAt: new Date().toISOString(),
  }
  const unresolvedGbp = Number((reservedGbp - entry.gbp).toFixed(6))
  if (unresolvedGbp > 0)
    ledger.entries.push({
      ...entry,
      gbp: unresolvedGbp,
      inputTokens: 0,
      outputTokens: 0,
      state: 'reserved',
      reservationId: `${reservationId}:unresolved-attempts`,
      recordedAt: new Date().toISOString(),
    })
  await writeLedger(path, ledger)
}

export async function writeLedger(path: string, ledger: SpendLedger) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`)
}

function pricedCacheTokens(
  tokens: number,
  price: number | undefined,
  kind: string,
) {
  if (tokens === 0) return 0
  if (price === undefined)
    throw new Error(`Pricing is missing ${kind} USD-per-million tokens`)
  return tokens * price
}

function isMissingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
