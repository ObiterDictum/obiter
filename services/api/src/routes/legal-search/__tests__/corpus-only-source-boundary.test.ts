import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'

/**
 * Structural guard for the corpus-only API boundary.
 *
 * The owner's rule is absolute: the user-facing API must never contact the
 * National Archives. This file combines three checks, none of which alone
 * proves the absence of every possible egress:
 *
 *  1. A source scan of `services/api` for the provider fetch seam and the
 *     National Archives host, across every source extension and the whole
 *     package tree, not just `src/`.
 *  2. A static import walk from both production entry points, so a file that
 *     only the running process reaches is still checked, and a module that is
 *     not reachable cannot hide behind an unreferenced helper.
 *  3. A runtime check that `runtime.ts` constructs neither provider meter.
 *
 * The behavioural zero-upstream-call proof lives in `proxy-routes.test.ts`:
 * a counting fake provider that rejects if called. The static checks here
 * catch a call added in a branch no route test reaches; the runtime tests
 * prove the routes that do run make no upstream request.
 */

// `.../src/routes/legal-search/__tests__/` -> `src`
const apiSourceRoot = fileURLToPath(new URL('../../..', import.meta.url))
// `.../services/api/src/routes/legal-search/__tests__/` -> `services/api`
const apiPackageRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const sourceExtensions = new Set(['.ts', '.tsx', '.mts', '.mjs', '.cjs', '.js'])
const ignoredDirectories = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.obiter-storage',
  'test-fixtures',
])

const transpiler = new Bun.Transpiler({ loader: 'tsx' })

/**
 * The provider fetch seam. One exported function in
 * `@obiter/legal-source-provider` per upstream call shape; a new fetch helper
 * would have to avoid all of these names, which the host and specifier scans
 * below then catch.
 */
const providerFetchNames = [
  'fetchMojAuthoritySummaries',
  'fetchMojAuthorityDetail',
  'fetchMojAuthorityDocumentById',
  'fetchMojAuthorityDocumentFromRecord',
  'hydrateMojAuthoritiesFromSearch',
  'hydrateAndIndexMojAuthorities',
]

/**
 * Provider module specifiers a fetch-through would import. The package's
 * public entry (`@obiter/legal-source-provider`) is allowed: the routes use it
 * for request schemas, citation parsing and type guards.
 */
const providerFetchSpecifiers = [
  '@obiter/legal-source-provider/moj-provider',
  '@obiter/legal-source-provider/fetch',
  './moj-client',
  'legal-search/moj-client',
]

const tnaHost = 'nationalarchives.gov.uk'

/**
 * The base URL default is a config value, not a call site. It is allowed only
 * in the env modules that resolve it for the retained indexing machinery; no
 * hostname check scopes the writer, so no request path may name it.
 */
const hostAllowedFiles = new Set(
  ['env.ts', 'env-corpus.ts', 'test-api-env.ts'].map((name) =>
    join(apiSourceRoot, name),
  ),
)

function isTestFile(path: string) {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return (
    path.includes('__tests__') ||
    name.includes('test-support') ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(name)
  )
}

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
      continue
    }
    if (!sourceExtensions.has(extname(entry.name))) continue
    if (isTestFile(full)) continue
    files.push(full)
  }
  return files
}

function sourceOffences(file: string, source: string): string[] {
  const offences: string[] = []
  for (const name of providerFetchNames) {
    if (source.includes(name)) offences.push(name)
  }
  for (const specifier of providerFetchSpecifiers) {
    if (source.includes(specifier)) offences.push(`${specifier} (specifier)`)
  }
  if (!hostAllowedFiles.has(file) && source.includes(tnaHost)) {
    offences.push(`${tnaHost} (host)`)
  }
  return offences
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base]
  for (const extension of sourceExtensions) {
    candidates.push(`${base}${extension}`)
    candidates.push(join(base, `index${extension}`))
  }
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Not a file: try the next candidate.
    }
  }
  return null
}

/** Import specifiers, over-approximated when Bun's scanner rejects a file. */
function importedPaths(source: string): string[] {
  try {
    return transpiler.scanImports(source).map((entry) => entry.path)
  } catch {
    // Bun's scanner rejects a few valid constructs (for example dynamic
    // imports in `redaction-detection.ts`). The regex fallback only needs to
    // over-approximate imports so the walk cannot silently miss a module.
    const paths: string[] = []
    for (const match of source.matchAll(
      /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g,
    )) {
      if (match[1]) paths.push(match[1])
    }
    return paths
  }
}

/** Every local module reachable from the entry points by static import. */
function collectReachableModules(entries: string[]): string[] {
  const seen = new Set<string>()
  const queue = [...entries]
  while (queue.length > 0) {
    const file = queue.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const specifier of importedPaths(readFileSync(file, 'utf8'))) {
      const resolved = resolveRelative(file, specifier)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return [...seen]
}

describe('corpus-only source boundary', () => {
  it('has no Find Case Law fetch call in any API source file', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles(apiPackageRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const offence of sourceOffences(file, source)) {
        offenders.push(`${relative(apiPackageRoot, file)}: ${offence}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('reaches no provider fetch module from either production entry point', () => {
    const entries = ['server.ts', 'server-bun.ts'].map((name) =>
      join(apiSourceRoot, name),
    )
    for (const entry of entries) {
      expect(statSync(entry).isFile()).toBe(true)
    }

    const reachable = collectReachableModules(entries)

    // Non-vacuity: the walk must actually reach the corpus-only route module,
    // so a broken resolver cannot pass by tracing nothing.
    expect(reachable).toContain(
      join(apiSourceRoot, 'routes/legal-search/proxy-routes.ts'),
    )

    const offenders: string[] = []
    for (const file of reachable) {
      const source = readFileSync(file, 'utf8')
      for (const offence of sourceOffences(file, source)) {
        offenders.push(`${relative(apiPackageRoot, file)}: ${offence}`)
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
