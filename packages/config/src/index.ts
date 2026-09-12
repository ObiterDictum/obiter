import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'
import { collectEnvKeys, duplicateEnvKeyMessage } from './env-keys.mjs'

/*
 * Local `.env` resolution and parsing, shared by every Node process in the
 * monorepo.
 *
 * This existed as three copies: the API loader, the legal-ingestor loader and
 * the assignment scan in Vite's config. Fixing one left the others running the
 * old rule, and P1.30 is the second time a lane inherited another worktree's
 * `.env`. One implementation imported by both services is the only shape that
 * cannot drift.
 */

// The workspace root is where pnpm-workspace.yaml lives. It is the boundary the
// .env search must not cross: one worktree's .env must never be resolved from
// another's, which a fixed-depth walk cannot prevent.
const WORKSPACE_ROOT_MARKER = 'pnpm-workspace.yaml'

// Backstop for the case where no marker is ever found: a built image, a copied
// dist, a cwd under no workspace. Without it the walk would reach `/`, which is
// wider than the five-level walk it replaced and would let an unrelated
// ancestor .env satisfy required production keys. Outside a workspace the
// search must stay at least as narrow as the cap it replaces.
const MAX_LOCAL_ENV_WALK_DEPTH = 5

let localEnvLoaded = false
let localEnvFile: string | null = null

/**
 * Resolve the worktree's `.env` by walking up from `startDirectory` and
 * stopping at the workspace root. A directory carrying pnpm-workspace.yaml is
 * checked for a `.env` and then ends the search, so a lane worktree whose own
 * `.env` is missing resolves to nothing rather than silently inheriting the
 * checkout above it and connecting to another lane's database.
 */
export function resolveLocalEnvFile(startDirectory: string): string | null {
  let directory = startDirectory

  for (let depth = 0; depth < MAX_LOCAL_ENV_WALK_DEPTH; depth += 1) {
    const envPath = join(directory, '.env')
    if (existsSync(envPath)) return envPath

    if (existsSync(join(directory, WORKSPACE_ROOT_MARKER))) return null

    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }

  return null
}

/**
 * Parse a `.env` file into entries, refusing a key assigned more than once.
 *
 * Values come from node:util.parseEnv, the same parser Vite 8's loadEnv uses,
 * so the API and the web server cannot disagree on quoting, escapes or inline
 * comments. parseEnv collapses a repeated key last-wins, so the duplicate rule
 * is a separate scan over `collectEnvKeys`: a repeated key is a mistake, not a
 * precedence choice, and refusing it keeps a lane from running two values for
 * one key.
 *
 * Cross-file duplicates are not detected. The API reads only `.env`, while
 * loadEnv also layers `.env.local` and `.env.<mode>.local`, so a key present in
 * both files still diverges between the two halves. That is known and
 * deliberately out of scope here.
 */
export function parseLocalEnvFile(envPath: string): Map<string, string> {
  const source = readFileSync(envPath, 'utf8')
  const seen = new Set<string>()

  for (const key of collectEnvKeys(source)) {
    if (seen.has(key)) throw new Error(duplicateEnvKeyMessage(envPath, key))
    seen.add(key)
  }

  const entries: Array<[string, string]> = Object.entries(parseEnv(source)).map(
    ([key, value]) => [key, value ?? ''],
  )

  return new Map(entries)
}

/**
 * Load the worktree's `.env` into process.env without overriding values the
 * process already has, and return the path read (null when none was). The path
 * is reported by /api/health provenance so a lane can prove its configuration
 * file as well as its checkout. Skipped under test runners so a suite never
 * reads a developer's .env; the result is memoized for the process lifetime.
 */
export function loadLocalEnvFile(
  startDirectory: string = process.cwd(),
): string | null {
  if (localEnvLoaded || process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return localEnvFile
  }

  localEnvLoaded = true
  const envPath = resolveLocalEnvFile(startDirectory)
  if (!envPath) return null

  for (const [key, value] of parseLocalEnvFile(envPath)) {
    process.env[key] ??= value
  }

  localEnvFile = envPath
  return localEnvFile
}

export type NodeEnv = 'development' | 'test' | 'production'

/**
 * Resolve `NODE_ENV`, refusing an unrecognised or missing value.
 *
 * Shared because the cost of getting it wrong is asymmetric: a misconfigured
 * reader serves the wrong page and someone notices, but a misconfigured writer
 * (the legal ingestor) puts rows in the wrong database and nobody does until
 * the data is queried later. The ingestor used to fall back to `development`
 * here, so an ingest run in an unconfigured worktree wrote the shared `obiter`
 * database with the `dev-key` search credential instead of stopping.
 *
 * An unset value needs an explicit local development opt-in so that a missing
 * `NODE_ENV` fails closed rather than guessing the mode.
 */
export function readNodeEnv(): NodeEnv {
  const raw = process.env.NODE_ENV

  if (raw === 'production' || raw === 'test' || raw === 'development') {
    return raw
  }

  if (raw === undefined || raw === '') {
    if (process.env.OBITER_LOCAL_DEVELOPMENT === '1') {
      return 'development'
    }

    throw new Error(
      'NODE_ENV must be production, test, or development. For local development with an unset NODE_ENV, set OBITER_LOCAL_DEVELOPMENT=1.',
    )
  }

  throw new Error(
    `NODE_ENV must be production, test, or development; got "${raw}".`,
  )
}
