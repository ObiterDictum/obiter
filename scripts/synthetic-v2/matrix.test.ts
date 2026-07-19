import { describe, expect, it } from 'vitest'
import { datasetStats } from './artifacts'
import { buildQuotaSpecs, expectedMatrixCells } from './matrix'

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

  it('reports a missing cell rather than silently treating a partial matrix as full', () => {
    const stats = datasetStats([])
    expect(stats.missingMatrixCells).toHaveLength(816)
  })
})
