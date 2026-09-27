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
 * `webPort` is the port the dev server will actually bind, after Vite has
 * merged its CLI options — see `applyDevServerApiOrigin`. The shared dev
 * default `http://localhost:8787` is allowed only when that effective port is
 * the shared web port 3000; a non-shared server that names neither
 * OBITER_API_ORIGIN nor PORT is a configuration mistake and is refused rather
 * than silently pointed at the shared API.
 *
 * BETTER_AUTH_URL is deliberately not read here. In production it remains the
 * API's session callback origin and the SSR `apiUrl()` fallback, but the dev
 * server publishes the resolved origin as `process.env.OBITER_API_ORIGIN` to
 * the SSR transform, and that key wins the `??` chain. Reading
 * BETTER_AUTH_URL here would make it a second way to choose a dev backend,
 * which is the split this module exists to remove.
 */
import { SHARED_API_PORT, SHARED_WEB_PORT, readPort } from './lane-target.mjs'

export function resolveDevApiOrigin({ processEnv, fileEnv, webPort }) {
  const read = (key) => processEnv[key] ?? fileEnv?.[key]
  const configured = read('OBITER_API_ORIGIN')

  if (isConfigured(configured)) {
    return parseOrigin(configured, 'OBITER_API_ORIGIN')
  }

  const port = read('PORT')
  if (isConfigured(port)) {
    return `http://localhost:${readPort(port, 'PORT')}`
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

/**
 * Wire the resolved origin into a resolved Vite config: the `/api` proxy target
 * and the SSR-only `process.env.OBITER_API_ORIGIN` define. Both come from one
 * `resolveDevApiOrigin` call, so the browser and the in-process SSR handler can
 * never be pointed at different backends.
 *
 * The port is `config.server.port`, which is the effective port only after
 * Vite's `configResolved` hook has run and CLI options such as `--port` have
 * been merged. The proxy object is mutated in place because Vite copies
 * `server.proxy` into `preview.proxy` before `configResolved`; replacing it
 * would leave `vite preview` without a proxy.
 */
export function applyDevServerApiOrigin(config, { processEnv, fileEnv }) {
  const apiOrigin = resolveDevApiOrigin({
    processEnv,
    fileEnv,
    webPort: config.server.port,
  })

  config.server.proxy ??= {}
  config.server.proxy['/api'] = { target: apiOrigin, changeOrigin: false }
  config.environments.ssr.define = {
    ...config.environments.ssr.define,
    'process.env.OBITER_API_ORIGIN': JSON.stringify(apiOrigin),
  }
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
      `${key} is not a valid URL: "${redactCredentials(raw)}". Set it to an ` +
        'http(s) origin such as http://localhost:8789.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    // `url.origin` drops any userinfo, so a credentialed mistake is not echoed.
    throw new Error(`${key} must be an http(s) origin; got "${url.origin}".`)
  }
  return url.origin
}

/** Mask `user:password@` userinfo before a value is put into an error message. */
function redactCredentials(value) {
  return String(value).replace(/\/\/[^/@\s]*@/, '//<redacted>@')
}
