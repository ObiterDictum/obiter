#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const PRIVATE_PATHS = [
  'services/api/',
  'services/legal-ingestor/',
  'services/atlas-ingestor/',
  'packages/legal-source-provider/',
  'packages/legal-schema/',
  'packages/search-client/',
  'packages/verification-core/',
  'packages/database/',
  'scripts/api-ingress/',
  'scripts/api-runtime/',
  'scripts/load/',
  'scripts/search-corpus-relevance/',
  'scripts/legislation-relevance/',
  'scripts/word-roundtrip/',
  'scripts/eval-redact.ts',
  'scripts/prefetch-rampart-model.ts',
  'scripts/generate-upload-corpus.py',
  'scripts/test_generate_upload_corpus.py',
  'scripts/bun-runtime-eval/',
  'docs/specs/search/',
  'docs/specs/verify/',
  'docs/specs/atlas/',
  'docs/specs/research/',
  'data/evals/search/',
  'infra/docker/',
  'infra/traefik/',
]

export const PRIVATE_PACKAGES = [
  '@obiter/api',
  '@obiter/legal-ingestor',
  '@obiter/legal-source-provider',
  '@obiter/legal-schema',
  '@obiter/search-client',
  '@obiter/verification-core',
  '@obiter/database',
]

export const PRIVATE_MODULES = ['moj-client', 'atom-parser', 'html-parser']

const SOURCE = /\.(?:[cm]?[jt]sx?)$/
const SPECIFIER =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm

export function pathViolation(file) {
  return PRIVATE_PATHS.some((entry) =>
    entry.endsWith('/') ? file.startsWith(entry) : file === entry,
  )
}

export function specifierViolations(file, text) {
  const violations = []
  const specifiers = [...text.matchAll(SPECIFIER)].map((match) => match[1])
  for (const specifier of specifiers) {
    const pkg = PRIVATE_PACKAGES.find(
      (name) => specifier === name || specifier.startsWith(`${name}/`),
    )
    if (pkg) violations.push(`${file}: imports ${pkg} (${specifier})`)
    const moduleName = PRIVATE_MODULES.find(
      (name) =>
        specifier === name ||
        specifier.endsWith(`/${name}`) ||
        specifier.endsWith(`/${name}.js`) ||
        specifier.endsWith(`/${name}.ts`),
    )
    if (moduleName)
      violations.push(`${file}: imports ${moduleName} (${specifier})`)
  }
  if (file.endsWith('package.json')) {
    for (const pkg of PRIVATE_PACKAGES) {
      if (new RegExp(`"${pkg.replace('/', '\\/')}"\\s*:`).test(text))
        violations.push(`${file}: depends on ${pkg}`)
    }
  }
  return violations
}

export function checkPrivatePaths({ root, files }) {
  const violations = []
  for (const file of files) {
    if (pathViolation(file)) {
      violations.push(`${file}: backend path`)
      continue
    }
    if (!SOURCE.test(file) && !file.endsWith('package.json')) continue
    const absolute = path.join(root, file)
    if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) continue
    violations.push(
      ...specifierViolations(file, readFileSync(absolute, 'utf8')),
    )
  }
  return violations
}

function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
  return output.split('\0').filter(Boolean)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const root = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
    '../..',
  )
  const violations = checkPrivatePaths({ root, files: trackedFiles(root) })
  if (violations.length > 0) {
    for (const violation of violations) console.error(violation)
    console.error(
      `\n${violations.length} private backend path or import(s). The API and the case-law code live in the private ObiterDictum/backend repository; see docs/backend-repo-split.md.`,
    )
    process.exit(1)
  }
  console.log('no private backend paths or imports')
}
