import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'bun:test'

const apiSourceRoot = fileURLToPath(new URL('../../..', import.meta.url))
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

const providerFetchNames = [
  'fetchMojAuthoritySummaries',
  'fetchMojAuthorityDetail',
  'fetchMojAuthorityDocumentById',
  'fetchMojAuthorityDocumentFromRecord',
  'hydrateMojAuthoritiesFromSearch',
  'hydrateAndIndexMojAuthorities',
]

const providerFetchSpecifiers = [
  '@obiter/legal-source-provider/moj-provider',
  '@obiter/legal-source-provider/fetch',
  './moj-client',
  'legal-search/moj-client',
]

const providerPublicSpecifier = '@obiter/legal-source-provider'

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

const fetchAllowedFiles = new Map<string, string>([
  [
    join(apiSourceRoot, 'routes/changelog.ts'),
    'fixed GitHub releases/commits changelog endpoint',
  ],
])

const tnaHostPattern = /nationalarchives\.gov\.uk/
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
    const text = literalText(node)
    if (
      text !== null &&
      tnaHostPattern.test(text) &&
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
    } catch {}
  }
  return null
}

function importedPaths(source: string): string[] {
  try {
    return transpiler.scanImports(source).map((entry) => entry.path)
  } catch {
    const paths: string[] = []
    for (const match of source.matchAll(
      /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g,
    )) {
      if (match[1]) paths.push(match[1])
    }
    return paths
  }
}

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
