import type { Pool } from 'pg'
import { appendAuditLog } from './database'

/**
 * The success audit for `POST /api/auth/change-password`.
 *
 * better-auth applies the password change, revokes the other sessions and mints
 * the replacement session inside its own handler, before it produces the 200
 * the route returns. There is no shared transaction to join: better-auth's
 * adapter commits each of those writes through the pool, and the audit insert
 * is a later, separate statement. A failure here therefore cannot roll the
 * change back — so it must not be allowed to rewrite a completed credential
 * mutation as a failure.
 *
 * This appends the row when it can and reports when it cannot. A rejection is
 * logged as a structured operational error carrying identifiers only (action,
 * user id, organisation id, request id, message): the request body is never
 * read, so no password or token can reach the log, and `metadata` stays empty
 * so no name can reach the audit row.
 *
 * Returns `true` when the row was written, `false` when the append failed.
 */
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
