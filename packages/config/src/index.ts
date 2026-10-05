export {
  loadLocalEnvFile,
  parseLocalEnvFile,
  resolveLocalEnvFile,
} from './local-env.mjs'

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
