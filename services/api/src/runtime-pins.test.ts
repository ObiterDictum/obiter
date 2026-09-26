import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'bun:test'

/**
 * Keeps the pinned runtimes coherent across every place that names one.
 *
 * The Bun version lives in four places that cannot import from each other:
 * `.bun-version` (what CI and local setup install), root `package.json`
 * `packageManager`, and the `ARG BUN_VERSION` plus the literal
 * `COPY --from=oven/bun:<version>-slim` in each workspace Dockerfile. Docker
 * does not expand an ARG inside a `COPY --from` image reference, so that
 * literal is `BUN_VERSION` transcribed by hand — the one link a version bump
 * can miss while still building successfully, shipping an image whose base and
 * toolchain disagree. This test is what makes the pin a pin rather than four
 * copies of a string.
 *
 * Node has no `.node-version` file; CI names only the major while the
 * Dockerfiles pin a full patch, so the assertions below require the two
 * Dockerfiles to agree with each other and the CI major to match, and do not
 * require CI to pin the patch it never carried.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

const read = (relativePath: string) =>
  readFileSync(join(repoRoot, relativePath), 'utf8')

/** Dockerfiles under the workspace groups that can carry an image runtime. */
function workspaceDockerfiles(): { path: string; source: string }[] {
  return ['apps', 'packages', 'services', 'infra'].flatMap((group) =>
    readdirSync(join(repoRoot, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${group}/${entry.name}/Dockerfile`)
      .filter((relativePath) => existsSync(join(repoRoot, relativePath)))
      .map((relativePath) => ({
        path: relativePath,
        source: read(relativePath),
      })),
  )
}

/** The global `ARG <name>=<value>` default, ignoring in-stage redeclarations. */
function argDefault(source: string, name: string): string | null {
  const match = source.match(new RegExp(`^ARG\\s+${name}=([^\\s#]+)`, 'm'))
  return match ? match[1].trim() : null
}

/** The literal in `COPY --from=<image>:<tag>`, which ARG cannot expand. */
function copiedFromImage(source: string, image: string): string | null {
  const match = source.match(
    new RegExp(`COPY\\s+--from=${image.replace('/', '\\/')}:([^\\s]+)`),
  )
  return match ? match[1].trim() : null
}

function workflowFiles(): string[] {
  const directory = join(repoRoot, '.github/workflows')
  return readdirSync(directory)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => join(directory, name))
}

describe('runtime image pins', () => {
  const bunPin = read('.bun-version').trim()
  const dockerfiles = workspaceDockerfiles().filter(
    (file) => argDefault(file.source, 'BUN_VERSION') !== null,
  )

  it('pins Bun as a bare version in .bun-version', () => {
    expect(bunPin).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('has at least the API and web images carrying the Bun pin', () => {
    expect(dockerfiles.map((file) => file.path).sort()).toEqual([
      'apps/web/Dockerfile',
      'services/api/Dockerfile',
    ])
  })

  for (const file of dockerfiles) {
    it(`${file.path} names the pinned Bun in ARG, COPY --from and FROM`, () => {
      expect(argDefault(file.source, 'BUN_VERSION')).toBe(bunPin)
      // The runtime stage selects the same pin the build stage copies.
      expect(file.source).toContain('FROM oven/bun:${BUN_VERSION}-slim')
      expect(copiedFromImage(file.source, 'oven/bun')).toBe(`${bunPin}-slim`)
    })
  }

  it('keeps packageManager in step with .bun-version', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      packageManager?: string
    }
    expect(packageJson.packageManager).toBe(`bun@${bunPin}`)
  })

  it('makes every CI checkout of Bun read .bun-version', () => {
    let count = 0
    for (const path of workflowFiles()) {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.includes('bun-version-file:')) continue
        count += 1
        expect(line).toContain('bun-version-file: .bun-version')
      }
    }
    expect(count).toBeGreaterThan(0)
  })

  it('agrees on the Node base between the two Dockerfiles and CI', () => {
    const nodePins = dockerfiles.map((file) => ({
      path: file.path,
      version: argDefault(file.source, 'NODE_VERSION'),
    }))
    const pinned = new Set(nodePins.map((entry) => entry.version))
    expect(pinned.size).toBe(1)
    const [nodeVersion] = [...pinned]
    expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/)

    for (const file of workflowFiles()) {
      const source = readFileSync(file, 'utf8')
      for (const line of source.split('\n')) {
        if (line.includes('node-version:')) {
          expect(line).toContain(`node-version: ${nodeVersion?.split('.')[0]}`)
        }
      }
    }
  })
})
