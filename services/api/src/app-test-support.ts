import type { Pool } from 'pg'
import type { createAuth } from './auth'
import type { ApiEnv } from './env'
import { createTestApiEnv } from './test-api-env'


export type Auth = ReturnType<typeof createAuth>
export type QueryMock = (...args: unknown[]) => Promise<{ rows: unknown[] }>

export interface ErrorBody {
  error: {
    code: string
    message: string
    requestId: string
  }
}

export const testEnv: ApiEnv = createTestApiEnv()

export function createPool(query: QueryMock): Pool {
  return {
    query,
  } as unknown as Pool
}

export function createConnectedPool(query: QueryMock): Pool {
  return {
    connect: async () => ({
      query,
      release: () => undefined,
    }),
  } as unknown as Pool
}

export function createHybridPool(
  query: QueryMock,
  transactionQuery: QueryMock,
): Pool {
  return {
    query,
    connect: async () => ({
      query: transactionQuery,
      release: () => undefined,
    }),
  } as unknown as Pool
}
