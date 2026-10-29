import { execFileSync } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseLocalEnvFile,
  resolveLocalEnvFile,
} from '@obiter/config/local-env'

export const SHARED_WEB_PORT = 3000
export const SHARED_API_PORT = 8787

export const WORKTREE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

export function resolveLaneTargets({
  startDirectory = WORKTREE_ROOT,
  processEnv = process.env,
} = {}) {
  const envFile = resolveLocalEnvFile(startDirectory)
  const fileEnv = envFile ? parseLocalEnvFile(envFile) : new Map()
  const read = (key) => processEnv[key] ?? fileEnv.get(key)

  const webPort = readPort(
    read('OBITER_WEB_PORT'),
    'OBITER_WEB_PORT',
    SHARED_WEB_PORT,
  )
  const apiPort = readPort(read('PORT'), 'PORT', SHARED_API_PORT)
  const apiOrigin = read('OBITER_API_ORIGIN') ?? `http://127.0.0.1:${apiPort}`

  return {
    envFile,
    webPort,
    apiPort,
    webOrigin: `http://localhost:${webPort}`,
    apiOrigin,
  }
}

export function readPort(raw, key, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const value = String(raw)
  const port = Number(value)
  if (!/^[0-9]+$/.test(value) || port <= 0 || port > 65535) {
    throw new Error(
      `${key} must be a decimal port between 1 and 65535; got "${value}". ` +
        `Fix it in the run environment or in this worktree's .env.`,
    )
  }
  return port
}

export function assertLaneTargets(targets, { reuseExistingServer }) {
  if (!reuseExistingServer) return

  const shared = []
  if (targets.webPort === SHARED_WEB_PORT) {
    shared.push(`OBITER_WEB_PORT=${SHARED_WEB_PORT}`)
  }
  if (targets.apiPort === SHARED_API_PORT)
    shared.push(`PORT=${SHARED_API_PORT}`)
  if (shared.length === 0) return

  throw new Error(
    `Refusing to run the e2e suite against the shared dev ports (${shared.join(', ')}). ` +
      `With reuseExistingServer a run on these ports would reuse the shared server on ` +
      `3000/8787 and measure another worktree's code. Set the lane's own ports in ` +
      `${targets.envFile ?? join(WORKTREE_ROOT, '.env')} (lane-security: ` +
      `OBITER_WEB_PORT=3004 and PORT=8791) or export them for this run.`,
  )
}

export async function verifyServedCheckout(
  targets,
  { worktreeRoot = WORKTREE_ROOT, fetchImpl = fetch, headSha } = {},
) {
  const webRoot = await servedWebCheckout(targets.webOrigin, fetchImpl)
  if (webRoot === null) {
    throw new Error(
      `Could not determine which checkout the web server at ${targets.webOrigin} ` +
        `serves: no Vite dev module with absolute paths answered there.`,
    )
  }
  if (!isInside(webRoot, worktreeRoot)) {
    throw new Error(
      `The web server at ${targets.webOrigin} serves ${webRoot}, not this ` +
        `worktree (${worktreeRoot}). Restart it from this checkout.`,
    )
  }

  const health = await servedApiHealth(targets.apiOrigin, fetchImpl)
  const provenance =
    health !== null && typeof health === 'object' ? health.provenance : null
  if (!provenance || typeof provenance.checkoutRoot !== 'string') {
    throw new Error(
      `The API at ${targets.apiOrigin} reported no development provenance, so its ` +
        `checkout cannot be attributed. Start it from this worktree in development.`,
    )
  }
  if (provenance.checkoutRoot !== worktreeRoot) {
    throw new Error(
      `The API at ${targets.apiOrigin} serves ${provenance.checkoutRoot}, not this ` +
        `worktree (${worktreeRoot}). Restart it from this checkout.`,
    )
  }
  if (headSha && provenance.commitSha !== headSha) {
    throw new Error(
      `The API at ${targets.apiOrigin} is running ${provenance.commitSha} but this ` +
        `worktree is at ${headSha}. Restart it after a checkout change.`,
    )
  }
  if ((provenance.envFile ?? null) !== (targets.envFile ?? null)) {
    throw new Error(
      `The API at ${targets.apiOrigin} resolved its configuration from ` +
        `${provenance.envFile ?? 'no .env'} but this run expects ${targets.envFile ?? 'no .env'}.`,
    )
  }

  return { webRoot, apiRoot: provenance.checkoutRoot, envFile: targets.envFile }
}

export function headSha(startDirectory = WORKTREE_ROOT) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: startDirectory,
      encoding: 'utf8',
    }).trim()
  } catch {
    return null
  }
}

async function servedApiHealth(apiOrigin, fetchImpl) {
  let response
  try {
    response = await fetchImpl(`${apiOrigin}/api/health`)
  } catch (error) {
    throw new Error(
      `The API at ${apiOrigin} did not answer /api/health: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`The API at ${apiOrigin} answered ${response.status}.`)
  }
  return response.json()
}

const WEB_MODULE_CANDIDATES = [
  '/src/routes/__root.tsx',
  '/src/routes/index.tsx',
]
const ABSOLUTE_PATH_PATTERN =
  /\/@fs\/[^"')?\s]+|\/[^"')?\s]*\/apps\/web\/[^"')?\s]+/g

async function servedWebCheckout(webOrigin, fetchImpl) {
  for (const path of WEB_MODULE_CANDIDATES) {
    let body
    try {
      const response = await fetchImpl(`${webOrigin}${path}`)
      if (!response.ok) continue
      body = await response.text()
    } catch {
      continue
    }

    const paths = [...body.matchAll(ABSOLUTE_PATH_PATTERN)].map((match) =>
      match[0].replace(/^\/@fs/, ''),
    )
    const root = commonDirectory(paths)
    if (root) return root
  }
  return null
}

export function commonDirectory(paths) {
  if (paths.length === 0) return null

  let prefix = paths[0]
  for (const path of paths.slice(1)) {
    let index = 0
    while (
      index < prefix.length &&
      index < path.length &&
      prefix[index] === path[index]
    ) {
      index += 1
    }
    prefix = prefix.slice(0, index)
  }

  const cut = prefix.lastIndexOf(sep)
  return cut > 0 ? prefix.slice(0, cut) : null
}

function isInside(directory, root) {
  return directory === root || directory.startsWith(`${root}${sep}`)
}
