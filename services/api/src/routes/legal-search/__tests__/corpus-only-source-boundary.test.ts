import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'bun:test'

/**
 * Structural guard for the corpus-only API boundary.
 *
 * The owner's rule is absolute: the user-facing API must never contact the
 * National Archives. This file combines four checks, none of which alone
 * proves the absence of every possible egress:
 *
 *  1. A source scan of `services/api` across every source extension and the
 *     whole package tree, not just `src/`, for the provider fetch seam, the
 *     National Archives host, and direct `fetch(` calls.
 *  2. A static import walk from both production entry points, so a file that
 *     only the running process reaches is still checked, and a module that is
 *     not reachable cannot hide behind an unreferenced helper.
 *  3. A runtime check that `runtime.ts` constructs neither provider meter.
 *  4. Fail-first unit probes that feed the same scan known offences, so a
 *     scan that silently stops matching cannot pass unseen.
 *
 * The behavioural zero-upstream-call proof lives in `proxy-routes.test.ts`:
 * a counting fake provider that rejects if called. The static checks here
 * catch a call added in a branch no route test reaches; the runtime tests
 * prove the routes that do run make no upstream request.
 *
 * Limits, stated rather than implied. The fetch check matches a call whose
 * callee is the identifier `fetch` or a member named `fetch`; an aliased,
 * computed or dynamically constructed callee would evade it. The provider
 * name check is a text scan, so a comment that names a function reads as a
 * call. The host check fires on string and template literals, so a host built
 * at runtime from fragments is invisible. None of this is a proof of every
 * possible egress; it is a maintainable guard over the shapes a regression
 * actually takes, paired with the runtime counting-fake proof.
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
 * `@obiter/legal-source-provider` per upstream call shape. These names catch
 * the cheap reintroduction; the host and specifier scans below catch other
 * shapes, within the limits stated at the top of this file.
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

/** The provider package exports only through this entry. */
const providerPublicSpecifier = '@obiter/legal-source-provider'

/**
 * Provider public-entry symbols the API may import. The provider package has
 * one export path, so anything outside this list is treated as egress-capable:
 * a newly added or renamed provider fetch function fails the guard without
 * this list changing. Types appear because they name the same seam.
 */
const providerPureImports = new Set([
  'LegalFetchRequest',
  'MojRequestBudget',
  'MojRequestCharge',
  'ProviderSourceMetadata',
  'WithdrawnInfo',
  'extractNeutralCitation',
  'isSupportedFindCaseLawRequest',
  'legalDocumentIdSchema',
  'legalFetchRequestSchema',
  'parseFindCaseLawAtom',
  'parseJudgmentParagraphs',
  'readWithdrawnInfo',
])

/**
 * Direct `fetch(` is allowed only in these files, each with a stated reason.
 * It is a file allowlist, not a directory or a blanket exemption for every
 * fetch. `routes/changelog.ts` is the API's only intentional egress: the fixed
 * GitHub releases/commits endpoint.
 */
const fetchAllowedFiles = new Map<string, string>([
  [
    join(apiSourceRoot, 'routes/changelog.ts'),
    'fixed GitHub releases/commits changelog endpoint',
  ],
])

/** The upstream Find Case Law host. A scanned file that mentions it is either
 * configuration or a call site; only a configuration default is allowed. */
const tnaHostLabel = 'nationalarchives.gov.uk'

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

function parseSource(file: string, source: string): ts.SourceFile {
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.(m|c)?js$/.test(file)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
}

/** Direct `fetch(` calls, as source line numbers. Matching the parsed call
 * expression keeps comments and string literals from reading as egress. */
function directFetchCallLines(sourceFile: ts.SourceFile): number[] {
  const lines: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null
      if (name === 'fetch') {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        )
        lines.push(line + 1)
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return lines
}

/** Provider public-entry imports and re-exports outside the pure allowlist,
 * plus any namespace import, which would expose the fetch functions. */
function disallowedProviderImports(sourceFile: ts.SourceFile): string[] {
  const offences: string[] = []
  const check = (imported: string, kind: string): void => {
    if (!providerPureImports.has(imported)) {
      offences.push(`${imported} (provider ${kind})`)
    }
  }
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier
      if (
        !ts.isStringLiteral(specifier) ||
        specifier.text !== providerPublicSpecifier
      ) {
        continue
      }
      const bindings = statement.importClause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) {
        offences.push(`${providerPublicSpecifier} (namespace import)`)
        continue
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          check(element.propertyName?.text ?? element.name.text, 'import')
        }
      }
    }
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === providerPublicSpecifier &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        check(element.propertyName?.text ?? element.name.text, 're-export')
      }
    }
  }
  return offences
}

/** The literal text of a string or template literal node, or null. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans.map((span) => span.literal.text).join('')
    )
  }
  return null
}

/**
 * A TNA host literal is allowed only where it is a configuration default, not
 * an egress target: the fallback argument of `readRequiredUrl`, or the
 * `mojFindCaseLawBaseUrl` property in a test environment fixture. Any other
 * occurrence fails, including elsewhere in `env.ts`.
 */
function isConfigurationDefault(node: ts.Node): boolean {
  const parent = node.parent
  if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text === 'mojFindCaseLawBaseUrl'
  }
  return (
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    parent.expression.text === 'readRequiredUrl' &&
    parent.arguments.findIndex((argument) => argument === node) > 0
  )
}

function tnaHostOffences(sourceFile: ts.SourceFile): string[] {
  const offences: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      literalText(node)?.includes(tnaHostLabel) &&
      !isConfigurationDefault(node)
    ) {
      offences.push(`${tnaHostLabel} (host)`)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return offences
}

function sourceOffences(file: string, source: string): string[] {
  const sourceFile = parseSource(file, source)
  const offences: string[] = []
  for (const name of providerFetchNames) {
    if (source.includes(name)) offences.push(name)
  }
  for (const specifier of providerFetchSpecifiers) {
    if (source.includes(specifier)) offences.push(`${specifier} (specifier)`)
  }
  offences.push(...disallowedProviderImports(sourceFile))
  if (!fetchAllowedFiles.has(file)) {
    for (const line of directFetchCallLines(sourceFile)) {
      offences.push(`fetch() at line ${line} (direct fetch)`)
    }
  }
  offences.push(...tnaHostOffences(sourceFile))
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

/**
 * Fail-first probes for the guard itself. Each synthetic offence is the shape
 * a real regression takes; the same `sourceOffences` the scans above use must
 * return it. These are unit probes over strings, so they cannot pass by
 * scanning the wrong tree or skipping a file.
 */
describe('corpus-only boundary guard probes', () => {
  const innocent = join(apiSourceRoot, 'innocent-probe.ts')
  const envPath = join(apiSourceRoot, 'env.ts')

  it('flags a raw fetch of the MOJ env URL in an innocent module', () => {
    const offences = sourceOffences(
      innocent,
      'export const probe = () => fetch(env.mojFindCaseLawBaseUrl)\n',
    )
    expect(offences.some((offence) => offence.includes('(direct fetch)'))).toBe(
      true,
    )
  })

  it('flags a TNA host literal in env.ts that is not the config default', () => {
    const offences = sourceOffences(
      envPath,
      "export const leaked = 'https://caselaw.nationalarchives.gov.uk/x'\n",
    )
    expect(offences.some((offence) => offence.includes('(host)'))).toBe(true)
  })

  it('allows the real env.ts config default', () => {
    expect(sourceOffences(envPath, readFileSync(envPath, 'utf8'))).toEqual([])
  })

  it('flags a newly named provider function imported from the public entry', () => {
    const offences = sourceOffences(
      innocent,
      "import { fetchMojAuthoritySomethingBrandNew } from '@obiter/legal-source-provider'\n",
    )
    expect(offences).toContain(
      'fetchMojAuthoritySomethingBrandNew (provider import)',
    )
  })

  it('flags a namespace import of the provider package', () => {
    const offences = sourceOffences(
      innocent,
      "import * as provider from '@obiter/legal-source-provider'\n",
    )
    expect(offences).toContain(
      '@obiter/legal-source-provider (namespace import)',
    )
  })

  it('flags a host fetch in a non-.ts source extension', () => {
    const offences = sourceOffences(
      join(apiSourceRoot, 'innocent-probe.mts'),
      "export const probe = () => fetch('https://caselaw.nationalarchives.gov.uk/x')\n",
    )
    expect(offences.length).toBeGreaterThan(0)
  })

  it('allows the fixed-URL GitHub changelog fetch and no other fetch', () => {
    const changelog = join(apiSourceRoot, 'routes/changelog.ts')
    expect(fetchAllowedFiles.get(changelog)).toContain('GitHub')
    expect(sourceOffences(changelog, readFileSync(changelog, 'utf8'))).toEqual(
      [],
    )
  })
})
