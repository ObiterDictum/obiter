/*
 * Argument parsing, paths and the child environment for the runtime harness.
 *
 * Keeping the environment in one place is what makes the two runtimes
 * comparable: they differ only in the entry point and port, and every secret is
 * a placeholder the harness generates, never a real one from a developer's
 * environment.
 */
import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LifecycleError } from './lifecycle.mjs'

export const WORKTREE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
export const API_DIRECTORY = join(WORKTREE_ROOT, 'services', 'api')

// Placeholders, all long enough to satisfy the production secret floor. They
// are never real credentials and never leave this machine.
export const BETTER_AUTH_SECRET = 'obiter-api-runtime-harness-secret-0123456789'
const RESEND_KEY = 'obiter-api-runtime-harness-resend-key-0123456789'
const MEILI_KEY = 'obiter-api-runtime-harness-meili-key-0123456789'

export function parseArgs(argv) {
  const args = {
    runtime: 'both',
    databaseUrl: null,
    allowDatabase: null,
    bunBin: process.env.BUN_BIN ?? 'bun',
    rampartCacheDir: process.env.OBITER_RAMPART_CACHE_DIR ?? null,
    keep: false,
    verbose: false,
    jsonOut: null,
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const [flag, inline] = argv[index].split('=')
    const value = () => inline ?? argv[++index]
    switch (flag) {
      case '--runtime':
        args.runtime = value()
        break
      case '--database-url':
        args.databaseUrl = value()
        break
      case '--allow-database':
        args.allowDatabase = value()
        break
      case '--bun-bin':
        args.bunBin = value()
        break
      case '--rampart-cache-dir':
        args.rampartCacheDir = value()
        break
      case '--json-out':
        args.jsonOut = value()
        break
      case '--keep':
        args.keep = true
        break
      case '--verbose':
        args.verbose = true
        break
      case '--help':
        args.help = true
        break
      default:
        throw new LifecycleError('unknown_flag', `Unknown argument "${flag}".`)
    }
  }
  if (!args.help && !args.databaseUrl) {
    throw new LifecycleError(
      'database_url_required',
      '--database-url is required; the harness will not guess a database.',
    )
  }
  if (!args.help && !['node', 'bun', 'both'].includes(args.runtime)) {
    throw new LifecycleError(
      'runtime_unknown',
      `--runtime must be node, bun or both; got "${args.runtime}".`,
    )
  }
  return args
}

export function resolveRuntimes(runtime) {
  return runtime === 'both' ? ['node', 'bun'] : [runtime]
}

/** Production-shaped config, all of it overridden explicitly for the run. */
export function childEnvironment({
  port,
  databaseUrl,
  storageRoot,
  rampartCacheDir,
}) {
  return {
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    OBITER_WEB_ORIGIN: `http://127.0.0.1:${port}`,
    OBITER_RESEND_API_KEY: RESEND_KEY,
    MEILISEARCH_HOST: 'http://127.0.0.1:7700',
    MEILISEARCH_SEARCH_API_KEY: MEILI_KEY,
    MEILISEARCH_ADMIN_API_KEY: MEILI_KEY,
    LEGAL_AUTHORITIES_INDEX: 'legal_authorities',
    OBITER_STORAGE_ROOT: storageRoot,
    // Deterministic compatibility mode for the main run: an ambient
    // CORPUS_* from the developer's shell must not silently change the mode
    // under test (an empty value reads as unset at the environment boundary).
    // The corpus-mode boots override these explicitly.
    CORPUS_DATABASE_URL: '',
    CORPUS_WRITE_DATABASE_URL: '',
    ...(rampartCacheDir ? { OBITER_RAMPART_CACHE_DIR: rampartCacheDir } : {}),
  }
}

/**
 * The API only loads the detection model from a warm cache; it does not fetch
 * it. Prefetch through the repository's own `prefetch:rampart` script — run via
 * with `bun run`, because that script imports a workspace package the root `node_modules`
 * does not link — so the inference check exercises native CPU inference rather
 * than failing closed to heuristics.
 */
export async function prefetchDetectionModel({ cacheDir, worktreeRoot }) {
  await new Promise((resolve, reject) => {
    const child = spawn('bun', ['run', 'prefetch:rampart'], {
      cwd: worktreeRoot,
      env: { ...process.env, OBITER_RAMPART_CACHE_DIR: cacheDir },
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', (error) =>
      reject(
        new LifecycleError(
          'model_prefetch_failed',
          `Could not run "bun run prefetch:rampart": ${error.message}. The inference check needs a warm model cache.`,
        ),
      ),
    )
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new LifecycleError(
              'model_prefetch_failed',
              `"bun run prefetch:rampart" exited ${code}; the inference check needs a warm model cache.`,
            ),
          ),
    )
  })
}
