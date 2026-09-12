/*
 * Guard against a key assigned twice in a Vite env file.
 *
 * Vite's loadEnv is last-wins for a repeated key; the API's loader
 * (services/api/src/env.ts parseLocalEnvFile) is first-wins. The same
 * repo-root .env would therefore configure the API and the web server with
 * different values and no error. A duplicate key is a mistake in any case, so
 * refuse it here as the API refuses it, over the same files loadEnv reads.
 */
import { existsSync, readFileSync } from 'node:fs'

export function assertNoDuplicateEnvKeys(envFile) {
  if (!existsSync(envFile)) return

  const seen = new Set()
  for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    if (seen.has(key)) {
      throw new Error(
        `${envFile} assigns ${key} more than once. Remove the duplicate: the API and web loaders resolve a repeated key differently and would run with different values.`,
      )
    }

    seen.add(key)
  }
}
