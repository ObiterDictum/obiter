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
    const separator = argv[index].indexOf('=')
    const flag =
      separator === -1 ? argv[index] : argv[index].slice(0, separator)
    const inline =
      separator === -1 ? undefined : argv[index].slice(separator + 1)
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

export function childEnvironment({
  port,
  target,
  storageRoot,
  rampartCacheDir,
}) {
  return {
    NODE_ENV: 'production',
    PORT: String(port),
    DATABASE_URL: target.url,
    PGHOST: target.host,
    PGPORT: target.port,
    PGDATABASE: target.database,
    PGUSER: target.user,
    PGPASSWORD: target.password,
    BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    OBITER_WEB_ORIGIN: `http://127.0.0.1:${port}`,
    OBITER_RESEND_API_KEY: RESEND_KEY,
    MEILISEARCH_HOST: 'http://127.0.0.1:7700',
    MEILISEARCH_SEARCH_API_KEY: MEILI_KEY,
    MEILISEARCH_ADMIN_API_KEY: MEILI_KEY,
    LEGAL_AUTHORITIES_INDEX: 'legal_authorities',
    OBITER_REDACTION_RENDERER_URL: 'http://127.0.0.1:8790',
    OBITER_STORAGE_ROOT: storageRoot,
    CORPUS_DATABASE_URL: '',
    CORPUS_WRITE_DATABASE_URL: '',
    ...(rampartCacheDir ? { OBITER_RAMPART_CACHE_DIR: rampartCacheDir } : {}),
  }
}

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
