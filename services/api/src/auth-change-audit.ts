import type { Pool } from 'pg'
import { appendAuditLog } from './audit-log'

export interface PasswordChangedAuditInput {
  organisationId: string | null
  userId: string
  requestId: string
}

export async function appendPasswordChangedAudit(
  pool: Pool,
  input: PasswordChangedAuditInput,
): Promise<boolean> {
  try {
    await appendAuditLog(pool, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'user',
      entityId: input.userId,
      action: 'auth.password_changed',
      metadata: {},
      requestId: input.requestId,
    })
    return true
  } catch (error) {
    console.error('auth.password_changed audit append failed', {
      action: 'auth.password_changed',
      userId: input.userId,
      organisationId: input.organisationId,
      requestId: input.requestId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
