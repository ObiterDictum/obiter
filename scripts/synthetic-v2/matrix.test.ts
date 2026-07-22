import { describe, expect, it } from 'vitest'
import { datasetStats } from './artifacts'
import {
  assertTournamentStratification,
  buildQuotaSpecs,
  buildTournamentQuotaSpecs,
  expectedMatrixCells,
  generationSpecIdentity,
} from './matrix'
import { normalizeAnnotated } from './validation'

describe('v2 diversity matrix', () => {
  it('fills every required matrix cell in the 280-document benchmark plan', () => {
    const specs = buildQuotaSpecs(280, 'bench')
    const counts = new Map<string, number>()
    for (const spec of specs)
      for (const cell of spec.matrixCells)
        counts.set(cell, (counts.get(cell) ?? 0) + 1)

    expect(expectedMatrixCells()).toHaveLength(816)
    expect(expectedMatrixCells().every((cell) => counts.has(cell))).toBe(true)
  })

  it('uses realistic legal hard-negative formats', () => {
    const hardNegative = buildQuotaSpecs(8, 'bench').find(
      (spec) => spec.difficulty === 'hard_negative',
    )!
    const quotes = hardNegative.hardNegatives.map(
      (assertion) => assertion.quote,
    )
    for (const category of hardNegative.requiredCategories)
      expect(
        hardNegative.hardNegatives.some((assertion) =>
          assertion.id.includes(`:${category}:counterexample`),
        ),
      ).toBe(true)
    expect(quotes).toContainEqual(
      expect.stringMatching(/^\[2099\] EWHC \d+ \(KB\)$/),
    )
    expect(quotes).toContainEqual(
      expect.stringMatching(/^Claim No\. KB-2026-\d{6}$/),
    )
    expect(quotes).toContainEqual(expect.stringMatching(/^£\d{3},\d{3}$/))
    expect(quotes).toContainEqual(expect.stringMatching(/^Company No\. \d{8}$/))
  })

  it('uses a fixed stratified 24-document specification set for tournaments', () => {
    const specs = buildTournamentQuotaSpecs()
    expect(specs).toHaveLength(24)
    expect(() => assertTournamentStratification(specs)).not.toThrow()
  })

  it('reports a missing cell rather than silently treating a partial matrix as full', () => {
    const stats = datasetStats([])
    expect(stats.missingMatrixCells).toHaveLength(816)
  })

  it('persists one canonical identity for every required category cell', () => {
    const spec = buildQuotaSpecs(1, 'bench')[0]!
    const document = normalizeAnnotated(
      spec,
      { text: 'Fictional document.', generator: 'fake:writer' },
      spec.requiredCategories.map((category, index) => ({
        category,
        start: index,
        end: index + 1,
        text: 'Fictional document.'.slice(index, index + 1),
      })),
    )

    expect(document.specCell).toBe(generationSpecIdentity(spec))
    expect(document.specCell).toContain('||')
    expect(document.specCell).not.toBe(spec.matrixCells[0])
  })
})
