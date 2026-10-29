import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKER_FILE = '.obiter-build.json'
export const MARKER_SCHEMA = 1

export function provenanceDigest(entries) {
  const hash = createHash('sha256')
  for (const { name, bytes } of entries) {
    hash.update(name)
    hash.update('\0')
    hash.update(bytes)
    hash.update('\0')
  }
  return `sha256-${hash.digest('base64url')}`
}

async function clientAssetEntries(clientDir) {
  const assetsDir = join(clientDir, 'assets')
  let names
  try {
    names = (await readdir(assetsDir)).sort()
  } catch {
    return []
  }
  const entries = []
  for (const name of names) {
    const path = join(assetsDir, name)
    const info = await stat(path)
    if (!info.isFile()) continue
    entries.push({ name, bytes: await readFile(path) })
  }
  return entries
}

export async function computeArtifactDigest(clientDir) {
  const entries = await clientAssetEntries(clientDir)
  return {
    digest: provenanceDigest(entries),
    names: entries.map((e) => e.name),
  }
}

async function detectReactProduction(clientDir) {
  for (const { name, bytes } of await clientAssetEntries(clientDir)) {
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue
    if (bytes.includes('jsx-dev-runtime')) return false
  }
  return true
}

function gitField(repoRoot, args) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

export function buildIdentity(repoRoot) {
  const envCommit = process.env.OBITER_BUILD_COMMIT?.trim()
  const envDirty = process.env.OBITER_BUILD_DIRTY?.trim()
  const gitCommit = gitField(repoRoot, ['rev-parse', 'HEAD'])
  const gitStatus = gitField(repoRoot, ['status', '--porcelain'])
  if (envCommit && !/^[0-9a-f]{7,40}$/i.test(envCommit))
    throw new Error(
      `OBITER_BUILD_COMMIT is not a git commit SHA: ${JSON.stringify(envCommit)}`,
    )
  if (envDirty && !/^(0|1|true|false)$/i.test(envDirty))
    throw new Error(
      `OBITER_BUILD_DIRTY must be 0/1/true/false, got ${JSON.stringify(envDirty)}`,
    )
  const commit = envCommit || gitCommit
  const dirty =
    envDirty !== undefined && envDirty !== ''
      ? /^(1|true)$/i.test(envDirty)
      : gitStatus === null
        ? null
        : gitStatus.length > 0
  const commitSource = envCommit ? 'env' : gitCommit ? 'git' : 'unknown'
  return { commit: commit || null, commitSource, dirty }
}

export async function writeBuildProvenance(distDir, { repoRoot }) {
  const clientDir = join(distDir, 'client')
  const { digest, names } = await computeArtifactDigest(clientDir)
  if (names.length === 0)
    throw new Error(
      `no client assets under ${clientDir}; refusing to write provenance`,
    )
  const marker = {
    schema: MARKER_SCHEMA,
    ...buildIdentity(repoRoot),
    builtAt: new Date().toISOString(),
    reactProduction: await detectReactProduction(clientDir),
    assetCount: names.length,
    integrity: digest,
    hashedAssets: names,
  }
  await writeFile(
    join(distDir, MARKER_FILE),
    `${JSON.stringify(marker, null, 2)}\n`,
  )
  return marker
}

export async function readBuildProvenance(distDir) {
  try {
    const marker = JSON.parse(
      await readFile(join(distDir, MARKER_FILE), 'utf8'),
    )
    return marker?.schema === MARKER_SCHEMA ? marker : null
  } catch {
    return null
  }
}

export async function verifyArtifactIntegrity(distDir) {
  const marker = await readBuildProvenance(distDir)
  if (!marker)
    throw new Error(`no build provenance at ${join(distDir, MARKER_FILE)}`)
  const { digest } = await computeArtifactDigest(join(distDir, 'client'))
  if (digest !== marker.integrity)
    throw new Error(
      'artifact does not match its build provenance (modified after build)',
    )
  return marker
}

export async function verifyBuildProvenance(
  distDir,
  { expectCommit, requireClean = true } = {},
) {
  const marker = await verifyArtifactIntegrity(distDir)
  if (expectCommit && marker.commit !== expectCommit)
    throw new Error(
      `artifact commit is ${marker.commit ?? 'unknown'}, expected ${expectCommit}`,
    )
  if (requireClean && marker.dirty !== false)
    throw new Error(
      `artifact provenance is not a clean build (dirty=${String(marker.dirty)})`,
    )
  if (marker.reactProduction !== true)
    throw new Error('artifact was not compiled with production React')
  return marker
}

const invokedScript = process.argv[1]
const isMain =
  invokedScript && pathToFileURL(invokedScript).href === import.meta.url

if (isMain) {
  const appRoot = fileURLToPath(new URL('./', import.meta.url))
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  const distDir = join(appRoot, 'dist')
  const [command, ...rest] = process.argv.slice(2)
  const option = (name) => {
    const i = rest.indexOf(`--${name}`)
    return i === -1 ? undefined : rest[i + 1]
  }
  try {
    if (command === 'write') {
      const marker = await writeBuildProvenance(distDir, { repoRoot })
      console.log(
        `build provenance: ${marker.commit ?? 'unknown'}${marker.dirty ? ' (dirty)' : ''}, ` +
          `${marker.assetCount} assets, reactProduction=${String(marker.reactProduction)}`,
      )
    } else if (command === 'verify') {
      const marker = await verifyBuildProvenance(distDir, {
        expectCommit: option('expect-commit'),
        requireClean: !rest.includes('--allow-dirty'),
      })
      console.log(`build provenance: ok (${marker.commit ?? 'unknown'})`)
    } else {
      throw new Error(
        'usage: build-provenance.mjs write|verify [--expect-commit <sha>] [--allow-dirty]',
      )
    }
  } catch (error) {
    console.error(`build provenance: ${error.message}`)
    process.exit(1)
  }
}
