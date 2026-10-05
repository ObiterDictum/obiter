import { ApiBootError } from './runtime'

/**
 * How long a drain may take before the process is forced to exit non-zero.
 * Short enough that a supervisor's own kill timeout is never the thing that
 * ends the process, long enough for an in-flight inference or upload.
 */
export const DEFAULT_DRAIN_DEADLINE_MS = 10_000

/**
 * What a runtime must expose for shutdown. Each adapter supplies its own
 * socket-layer calls; the order, the deadline and the exit code are owned here
 * so both runtimes shut down identically.
 */
export interface DrainPlan {
  /** Stop accepting new work and settle once in-flight work has finished. */
  stopAccepting: () => Promise<void>
  /** Release resources this process owns — the Postgres pool today. */
  closeResources: () => Promise<void>
  /** Open connections, for the shutdown log. Omit when the adapter has none. */
  pendingCount?: () => number | Promise<number | null>
}

export interface DrainOptions {
  deadlineMs?: number
  log?: Pick<Console, 'info' | 'error'>
  exit?: (code: number) => void
}

/**
 * Bounded graceful shutdown: SIGTERM/SIGINT stops new work, lets in-flight
 * requests finish, closes the pool, then exits. The deadline is the only path
 * to a forced exit, and a second signal is ignored rather than interrupting a
 * drain already in progress.
 */
export function installGracefulShutdown(
  plan: DrainPlan,
  options: DrainOptions = {},
) {
  const deadlineMs = options.deadlineMs ?? DEFAULT_DRAIN_DEADLINE_MS
  const log = options.log ?? console
  const exit = options.exit ?? ((code: number) => process.exit(code))
  let shuttingDown = false

  async function drain(signal: NodeJS.Signals) {
    let pending: number | null = null
    if (plan.pendingCount) {
      try {
        pending = await plan.pendingCount()
      } catch {
        // The count is a log field, not a decision. A failure to read it must
        // not change how the drain itself proceeds.
        pending = null
      }
    }
    log.info(
      `Obiter API received ${signal}; draining` +
        `${pending === null ? '' : ` with ${pending} open connection(s)`}.`,
    )

    const forced = setTimeout(() => {
      log.error(
        `Obiter API did not drain within ${deadlineMs}ms; exiting non-zero.`,
      )
      exit(1)
    }, deadlineMs)
    forced.unref()

    try {
      await plan.stopAccepting()
      await plan.closeResources()
      clearTimeout(forced)
      log.info('Obiter API drained and database pool closed.')
      exit(0)
    } catch (error) {
      clearTimeout(forced)
      log.error('Obiter API shutdown failed.', error)
      exit(1)
    }
  }

  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    void drain(signal)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

function isAddressInUse(error: unknown) {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'EADDRINUSE') return true
  return error instanceof Error && error.message.includes('EADDRINUSE')
}

/** Report why boot failed and stop, rather than serving in an unknown state. */
export function exitOnStartupFailure(error: unknown): never {
  if (error instanceof ApiBootError) {
    console.error(
      error.message,
      error.cause instanceof Error ? error.cause.message : error.cause,
    )
  } else if (isAddressInUse(error)) {
    console.error('Port is already in use — is another API instance running?')
  } else {
    console.error('Obiter API failed to start.', error)
  }

  process.exit(1)
}
