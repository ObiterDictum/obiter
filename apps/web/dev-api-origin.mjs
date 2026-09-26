/*
 * The API origin the web dev server uses, for the Vite proxy and for SSR.
 *
 * The Vite dev server runs the TanStack Start SSR handler in the same Node
 * process, but Vite's `loadEnv` returns `.env` values without assigning them to
 * `process.env`. The proxy read the lane `.env`, while SSR `apiUrl()` and the
 * better-auth base URL read `process.env` and fell back to the shared dev API on
 * `http://localhost:8787` — so one page load authenticated against a different
 * backend than the browser requests it proxied.
 *
 * This is the one place a dev API origin is resolved, from the values Vite has
 * already read (the process environment first, then the worktree `.env`):
 *
 *   process env -> .env, OBITER_API_ORIGIN before PORT
 *
 * The result is what `apps/web/vite.config.ts` gives the proxy and publishes to
 * `process.env` for SSR. A non-shared dev server (a lane) that names neither
 * OBITER_API_ORIGIN nor PORT is a configuration mistake and is refused rather
 * than silently pointed at the shared API; only the shared dev server (web port
 * 3000) keeps `http://localhost:8787`, because that stack is intentionally
 * served from 8787.
 */
import { SHARED_API_PORT, SHARED_WEB_PORT } from './lane-target.mjs'

export function resolveDevApiOrigin({ processEnv, fileEnv, webPort }) {
  const read = (key) => processEnv[key] ?? fileEnv?.[key]
  const configured = read('OBITER_API_ORIGIN')

  if (isConfigured(configured)) {
    return parseOrigin(configured, 'OBITER_API_ORIGIN')
  }

  const port = read('PORT')
  if (isConfigured(port)) {
    return `http://localhost:${parsePort(port, 'PORT')}`
  }

  if (webPort === SHARED_WEB_PORT) {
    return `http://localhost:${SHARED_API_PORT}`
  }

  throw new Error(
    `The web dev server is on port ${webPort}, not the shared dev port ` +
      `${SHARED_WEB_PORT}, but neither OBITER_API_ORIGIN nor PORT configures ` +
      `an API. A lane must not fall back to the shared dev API on ` +
      `${SHARED_API_PORT}; set OBITER_API_ORIGIN in this worktree's .env.`,
  )
}

function isConfigured(value) {
  return value !== undefined && value !== null && String(value).trim() !== ''
}

function parseOrigin(raw, key) {
  let url
  try {
    url = new URL(String(raw))
  } catch {
    throw new Error(
      `${key} is not a valid URL: "${raw}". Set it to an http(s) origin such ` +
        'as http://localhost:8789.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${key} must be an http(s) origin; got "${raw}".`)
  }
  return url.origin
}

function parsePort(raw, key) {
  const value = String(raw)
  const port = Number(value)
  if (!/^[0-9]+$/.test(value) || port <= 0 || port > 65535) {
    throw new Error(
      `${key} must be a decimal port between 1 and 65535; got "${value}".`,
    )
  }
  return port
}
