import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  costGbp,
  pipelineWorstCaseGbp,
  readLedger,
  reconcileSpend,
  reserveSpend,
} from './budget'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

const pricing = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  cacheCreationUsdPerMillion: 3,
  cacheReadUsdPerMillion: 0.5,
}

describe('spend cap accounting', () => {
  it('charges cache token classes and requires their prices', () => {
    expect(
      costGbp(
        {
          inputTokens: 1_000_000,
          outputTokens: 1_000_000,
          cacheCreationInputTokens: 1_000_000,
          cacheReadInputTokens: 1_000_000,
        },
        pricing,
        1,
      ),
    ).toBe(6.5)
    expect(() =>
      costGbp(
        { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1 },
        { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
        1,
      ),
    ).toThrow('Pricing is missing cache read')
  })

  it('multiplies the complete paid plan across regeneration cycles', () => {
    const rates = Object.fromEntries(
      ['writer', 'annotator', 'primary', 'dispute'].map((model) => [
        model,
        { inputUsdPerMillion: 1, outputUsdPerMillion: 1 },
      ]),
    )
    const oneCycle = pipelineWorstCaseGbp(
      rates,
      [{ writer: 'writer', annotator: 'annotator' }],
      'primary',
      'dispute',
      1,
      1,
      1,
    )
    const threeCycles = pipelineWorstCaseGbp(
      rates,
      [{ writer: 'writer', annotator: 'annotator' }],
      'primary',
      'dispute',
      1,
      1,
      3,
    )
    expect(threeCycles).toBeCloseTo(oneCycle * 3, 6)
  })

  it('keeps unused retry capacity reserved after recording a successful attempt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'obiter-budget-'))
    directories.push(directory)
    const path = join(directory, 'ledger.json')
    const ledger = await readLedger(path, 30)
    await reserveSpend(path, ledger, {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      inputTokens: 6_000,
      outputTokens: 9_600,
      gbp: 12,
      reservationId: 'retry-safe',
    })
    await reconcileSpend(path, ledger, 'retry-safe', {
      provider: 'deepseek',
      model: 'deepseek-v4-pro',
      inputTokens: 1_500,
      outputTokens: 2_400,
      gbp: 3,
    })
    const persisted = parseLedger(await readFile(path, 'utf8'))
    expect(persisted.entries).toEqual([
      expect.objectContaining({ state: 'actual', gbp: 3 }),
      expect.objectContaining({ state: 'reserved', gbp: 9 }),
    ])
  })
})

function parseLedger(value: string): {
  entries: Array<{ state: string; gbp: number }>
} {
  try {
    return JSON.parse(value) as {
      entries: Array<{ state: string; gbp: number }>
    }
  } catch {
    throw new Error('Test ledger must contain valid JSON')
  }
}
