import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'
import { collectEnvKeys, duplicateEnvKeyMessage } from './env-keys.mjs'

const WORKSPACE_ROOT_MARKER = 'bun.lock'

const MAX_LOCAL_ENV_WALK_DEPTH = 5

let localEnvLoaded = false
let localEnvFile = null

export function resolveLocalEnvFile(startDirectory) {
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

export function parseLocalEnvFile(envPath) {
  const source = readFileSync(envPath, 'utf8')
  const seen = new Set()

  for (const key of collectEnvKeys(source)) {
    if (seen.has(key)) throw new Error(duplicateEnvKeyMessage(envPath, key))
    seen.add(key)
  }

  const entries = Object.entries(parseEnv(source)).map(([key, value]) => [
    key,
    value ?? '',
  ])

  return new Map(entries)
}

export function loadLocalEnvFile(startDirectory = process.cwd()) {
  if (
    localEnvLoaded ||
    process.env.NODE_ENV === 'test' ||
    process.env.OBITER_TEST_RUNNER
  ) {
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
