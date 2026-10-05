import type { Pool } from 'pg'

/**
 * Controlled barriers for the P0.13 lock-wait races.
 *
 * The row lock, not a sleep, is what orders the transactions. These helpers
 * only hold one transaction while another is issued against it and observe the
 * resulting wait in `pg_stat_activity`, so a test can prove the ordering it
 * means to exercise.
 */

/**
 * The in-transaction matter row lock every write path takes first.
 * `lockMatterForEdit` matches both before and after the lock-then-recheck
 * split, so a gate built on this predicate exercises the real statement.
 */
export function isMatterLockStatement(sql: string) {
  return sql.includes('for update') && sql.includes('matters')
}

interface GatedPool {
  entered: Promise<void>
  open: () => void
  pool: Pool
  backendPid: number | undefined
}

// node-postgres exposes the backend pid as `processID` on the client at
// runtime, but @types/pg does not declare it.
function backendPidOf(client: unknown) {
  const processID = (client as { processID?: unknown }).processID
  return typeof processID === 'number' ? processID : undefined
}

/**
 * Runs the first matching statement, then holds the transaction open until
 * `open()` is called. The statement has already executed, so the locks it took
 * are held while the caller controls what runs next. The backend pid lets a
 * test name this transaction as the blocker of a waiter.
 */
export function transactionPauseGate(
  pool: Pool,
  matches: (sql: string) => boolean,
): GatedPool {
  let markEntered: () => void = () => undefined
  let openGate: () => void = () => undefined
  let armed = true
  let backendPid: number | undefined
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  const opened = new Promise<void>((resolve) => {
    openGate = resolve
  })
  return {
    entered,
    open: () => openGate(),
    get backendPid() {
      return backendPid
    },
    pool: {
      query: (sql: string, parameters?: unknown[]) =>
        pool.query(sql, parameters),
      connect: async () => {
        const client = await pool.connect()
        backendPid = backendPidOf(client)
        return {
          query: async (sql: string, parameters: unknown[] = []) => {
            const result = await client.query(sql, parameters)
            if (armed && matches(sql)) {
              armed = false
              markEntered()
              await opened
            }
            return result
          },
          release: () => client.release(),
        }
      },
    } as unknown as Pool,
  }
}

/**
 * Sends the first matching statement and resolves `entered` once it has been
 * issued, without holding it. Used for the writer's matter lock, which is
 * expected to block on a revoker-held lock; the caller proves the wait with
 * `waitForLockWait` rather than assuming it from the fact that it was sent.
 */
export function transactionObserveGate(
  pool: Pool,
  matches: (sql: string) => boolean,
) {
  let markEntered: () => void = () => undefined
  let armed = true
  let backendPid: number | undefined
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  return {
    entered,
    get backendPid() {
      return backendPid
    },
    pool: {
      query: (sql: string, parameters?: unknown[]) =>
        pool.query(sql, parameters),
      connect: async () => {
        const client = await pool.connect()
        backendPid = backendPidOf(client)
        return {
          query: (sql: string, parameters: unknown[] = []) => {
            if (armed && matches(sql)) {
              armed = false
              markEntered()
            }
            return client.query(sql, parameters)
          },
          release: () => client.release(),
        }
      },
    } as unknown as Pool,
  }
}

/**
 * Waits until `waitingPid` is blocked on a row lock, returning the blockers.
 * The ordering is enforced by that lock; this only observes it and fails
 * loudly if the wait never happens, so no sleep is used as the ordering
 * mechanism.
 */
export async function waitForLockWait(
  pool: Pool,
  waitingPid: number,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs
  let lastSeen = 'not observed'
  while (Date.now() < deadline) {
    const result = await pool.query<{
      wait_event_type: string | null
      blockers: number[]
    }>(
      `select wait_event_type, pg_blocking_pids(pid) as blockers
       from pg_stat_activity where pid = $1`,
      [waitingPid],
    )
    const row = result.rows[0]
    if (row) {
      lastSeen = `${row.wait_event_type ?? 'running'} blocked by [${row.blockers.join(',')}]`
      if (row.wait_event_type === 'Lock' && row.blockers.length > 0) {
        return row.blockers
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(
    `backend ${waitingPid} did not block on a lock within ${timeoutMs}ms (last: ${lastSeen})`,
  )
}
