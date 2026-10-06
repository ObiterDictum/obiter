import type { Pool, QueryResult, QueryResultRow } from 'pg'

export type QueryCall = { text: string; values: unknown[] | undefined }

type QueryResponder = (
  text: string,
  values: unknown[] | undefined,
) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>

/**
 * A pool double that records the SQL and parameters it is handed. The single
 * cast is confined here: `pg`'s `Pool['query']` is an overloaded
 * stream/config/query signature that TypeScript will not accept a plain
 * two-argument function for. The responder must still return a complete
 * `QueryResult`, so a test cannot model a shape the real driver never produces.
 */
export function queryDouble(respond: QueryResponder) {
  const calls: QueryCall[] = []
  const query = async (text: string, values?: unknown[]) => {
    calls.push({ text, values })
    return respond(text, values)
  }
  return { pool: { query } as unknown as Pick<Pool, 'query'>, calls }
}

export function queryResult<Row extends QueryResultRow>(
  rows: Row[],
): QueryResult<Row> {
  return { command: 'SELECT', rowCount: rows.length, oid: 0, fields: [], rows }
}
