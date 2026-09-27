/*
 * Resolve the real web Vite config and print the dev API decision.
 *
 * Usage:
 *   bun config-decision.mjs <path-to-vite.config.ts> <port> [KEY=value]
 *
 * `port` is the inline server port, which stands in for a `--port` CLI
 * override. The process environment is neutralised to empty strings first so a
 * developer's worktree `.env` cannot change the result; `KEY=value` adds one
 * explicit value on top (for example `OBITER_WEB_PORT=oops`).
 *
 * It reads the resolved config only. It starts no server and contacts no API.
 */
import { resolveConfig } from 'vite'

const [, , configFile, rawPort, override] = process.argv
if (!configFile || !rawPort) {
  console.error('usage: bun config-decision.mjs <config> <port> [KEY=value]')
  process.exit(2)
}

for (const key of ['OBITER_API_ORIGIN', 'PORT', 'OBITER_WEB_PORT']) {
  if (process.env[key] === undefined) process.env[key] = ''
}
if (override) {
  const [key, value] = override.split('=')
  process.env[key] = value
}

try {
  const resolved = await resolveConfig(
    { configFile, logLevel: 'silent', server: { port: Number(rawPort) } },
    'serve',
    'development',
  )
  console.log(
    JSON.stringify({
      effectivePort: resolved.server.port,
      proxyTarget: resolved.server.proxy?.['/api']?.target,
      ssrDefine:
        resolved.environments.ssr?.define?.['process.env.OBITER_API_ORIGIN'],
    }),
  )
} catch (error) {
  console.log(JSON.stringify({ refused: error.message }))
}
