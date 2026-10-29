import { execFileSync } from 'node:child_process'

export class ProvisionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProvisionError'
    this.code = code
  }
}

export const PSQL_TIMEOUT_MS = 15_000
export const PSQL_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export function psqlEnvironment(databaseUrl, baseEnv = process.env) {
  const parsed = new URL(databaseUrl)
  return {
    PATH: baseEnv.PATH ?? '',
    HOME: baseEnv.HOME ?? '',
    LANG: baseEnv.LANG ?? 'C',
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'obiter-q3-load-harness',
  }
}

export function defaultRunner(
  sql,
  environment,
  { exec = execFileSync, timeoutMs = PSQL_TIMEOUT_MS } = {},
) {
  try {
    return exec(
      'psql',
      ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-f', '-'],
      {
        input: sql,
        encoding: 'utf8',
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
        maxBuffer: PSQL_MAX_OUTPUT_BYTES,
        killSignal: 'SIGKILL',
      },
    )
  } catch (error) {
    throw psqlFailure(error, timeoutMs)
  }
}

function psqlFailure(error, timeoutMs) {
  if (error?.code === 'ETIMEDOUT')
    return new ProvisionError(
      'query_timeout',
      `psql did not finish within ${timeoutMs} ms and was killed; the run cannot provision or verify.`,
    )
  if (error?.code === 'ENOBUFS')
    return new ProvisionError(
      'query_output_limit',
      `psql produced more than ${PSQL_MAX_OUTPUT_BYTES} bytes and was killed; a truncated result would misreport the run.`,
    )
  return new ProvisionError(
    'query_failed',
    `psql failed: ${error instanceof Error ? error.message : String(error)}`,
  )
}

export function createQuerier({
  databaseUrl,
  baseEnv = process.env,
  run,
} = {}) {
  const environment = psqlEnvironment(databaseUrl, baseEnv)
  const execute = run ?? defaultRunner
  return {
    rows(sql) {
      const text = execute(sql, environment)
      return JSON.parse(text.trim() === '' ? 'null' : text.trim()) ?? []
    },
    exec(sql) {
      execute(sql, environment)
    },
    environment,
  }
}
