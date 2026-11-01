import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkPrivatePaths } from './check-private-paths.mjs'

const roots = []

const specifier = (...parts) => parts.join('/')
const moduleName = (...parts) => parts.join('-')

function plantedTree(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'obiter-private-paths-'))
  roots.push(root)
  for (const [file, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), contents)
  }
  return root
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true })
})

describe('private backend paths', () => {
  test('rejects a tracked file under a moved backend path', () => {
    const root = plantedTree({
      'services/api/src/routes/search.ts': 'export {}\n',
    })
    expect(
      checkPrivatePaths({ root, files: ['services/api/src/routes/search.ts'] }),
    ).toEqual(['services/api/src/routes/search.ts: backend path'])
  })

  test('rejects a tracked migration beside the public renderer service', () => {
    const root = plantedTree({
      'packages/database/migrations/0042_extra.sql': 'select 1;\n',
      'services/redaction-renderer/README.md': '# renderer\n',
    })
    expect(
      checkPrivatePaths({
        root,
        files: [
          'packages/database/migrations/0042_extra.sql',
          'services/redaction-renderer/README.md',
        ],
      }),
    ).toEqual(['packages/database/migrations/0042_extra.sql: backend path'])
  })

  test('accepts a file whose name merely contains a moved path name', () => {
    const root = plantedTree({
      'scripts/lint/check-private-paths.mjs': 'export {}\n',
    })
    expect(
      checkPrivatePaths({
        root,
        files: ['scripts/lint/check-private-paths.mjs'],
      }),
    ).toEqual([])
  })
})

describe('private backend imports', () => {
  test('rejects an import of a backend package name', () => {
    const name = specifier('@obiter', 'search-client')
    const root = plantedTree({
      'packages/ui/src/search.ts': `import type { Hit } from '${name}'\n`,
    })
    expect(
      checkPrivatePaths({ root, files: ['packages/ui/src/search.ts'] }),
    ).toEqual([`packages/ui/src/search.ts: imports ${name} (${name})`])
  })

  test('rejects a require of a backend package subpath', () => {
    const name = specifier('@obiter', 'database')
    const root = plantedTree({
      'apps/web/lane.mjs': `const lane = require('${name}/target')\n`,
    })
    expect(checkPrivatePaths({ root, files: ['apps/web/lane.mjs'] })).toEqual([
      `apps/web/lane.mjs: imports ${name} (${name}/target)`,
    ])
  })

  test('rejects an import of a provider module name', () => {
    const name = moduleName('moj', 'client')
    const root = plantedTree({
      'packages/config/src/source.ts': `import { createClient } from './providers/${name}'\n`,
    })
    expect(
      checkPrivatePaths({ root, files: ['packages/config/src/source.ts'] }),
    ).toEqual([
      `packages/config/src/source.ts: imports ${name} (./providers/${name})`,
    ])
  })

  test('rejects a workspace manifest that depends on a backend package', () => {
    const name = specifier('@obiter', 'api')
    const root = plantedTree({
      'packages/ui/package.json': `{ "dependencies": { "${name}": "workspace:*" } }\n`,
    })
    expect(
      checkPrivatePaths({ root, files: ['packages/ui/package.json'] }),
    ).toEqual([`packages/ui/package.json: depends on ${name}`])
  })

  test('accepts a public package that shares the contracts with the backend', () => {
    const root = plantedTree({
      'packages/app-shell/src/search.ts':
        "import { hitSchema } from '@obiter/contracts'\n",
      'packages/app-shell/src/provenance.ts':
        'export const source = "Find Case Law"\n',
    })
    expect(
      checkPrivatePaths({
        root,
        files: [
          'packages/app-shell/src/search.ts',
          'packages/app-shell/src/provenance.ts',
        ],
      }),
    ).toEqual([])
  })
})
