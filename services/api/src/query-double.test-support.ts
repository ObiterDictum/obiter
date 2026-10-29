import type { Pool, QueryResult, QueryResultRow } from 'pg'

type QueryCall = { text: string; values: unknown[] | undefined }

type QueryResponder = (
  text: string,
  values: unknown[] | undefined,
) => QueryResult<QueryResultRow> | Promise<QueryResult<QueryResultRow>>

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
