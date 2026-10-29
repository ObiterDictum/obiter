export {
  loadLocalEnvFile,
  parseLocalEnvFile,
  resolveLocalEnvFile,
} from './local-env.mjs'

export type NodeEnv = 'development' | 'test' | 'production'

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
