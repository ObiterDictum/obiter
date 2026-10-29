import type { Pool } from 'pg'

export function isMatterLockStatement(sql: string) {
  return sql.includes('for update') && sql.includes('matters')
}

interface GatedPool {
  entered: Promise<void>
  open: () => void
  pool: Pool
  backendPid: number | undefined
}

function backendPidOf(client: unknown) {
  const processID = (client as { processID?: unknown }).processID
  return typeof processID === 'number' ? processID : undefined
}

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
