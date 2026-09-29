import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'

/**
 * Structural guard for the corpus-only API boundary.
 *
 * The owner's rule is absolute: the user-facing API must never contact the
 * National Archives. Every provider fetch lives behind one exported seam in
 * `@obiter/legal-source-provider` (`fetchMojAuthority*`), so scanning the
 * API's non-test source for those names fails the moment a future change
 * reintroduces an upstream call path, including one that a route test would
 * not exercise.
 *
 * This is deliberately a source scan rather than a runtime mock: it also
 * catches a call added in a branch no test reaches yet.
 */

const apiSourceRoot = fileURLToPath(new URL('../../..', import.meta.url))

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...listSourceFiles(full))
      continue
    }
    if (!entry.endsWith('.ts')) continue
    if (entry.endsWith('.test.ts')) continue
    if (entry.endsWith('.db.test.ts')) continue
    files.push(full)
  }
  return files
}

describe('corpus-only source boundary', () => {
  const providerFetchNames = [
    'fetchMojAuthoritySummaries',
    'fetchMojAuthorityDetail',
    'fetchMojAuthorityDocumentById',
    'fetchMojAuthorityDocumentFromRecord',
    'hydrateMojAuthoritiesFromSearch',
    'hydrateAndIndexMojAuthorities',
  ]

  it('has no Find Case Law fetch call in non-test API source', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles(apiSourceRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const name of providerFetchNames) {
        if (source.includes(name)) offenders.push(`${file}: ${name}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('does not construct a provider request meter in the API runtime', () => {
    const runtime = readFileSync(join(apiSourceRoot, 'runtime.ts'), 'utf8')
    expect(runtime).not.toContain('PostgresMojRequestBudget')
    expect(runtime).not.toContain('PostgresLegalHydrationLedger')
  })
})
