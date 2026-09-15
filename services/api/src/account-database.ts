import type { Pool } from 'pg'
import type { CurrentUser, UserRole } from '@obiter/contracts'
import { appendAuditLog } from './database'

/**
 * The account write path: the signed-in user's own display name. It lives here
 * rather than in `database.ts`, which already owns matters, documents,
 * organisations and audit storage and is far past the file-size ceiling.
 */

/**
 * Updates the caller's own display name and writes the audit row in one
 * transaction. The user id is the session's, supplied by the route, so there
 * is no request field a caller could change to reach another account. The
 * audit row records the action and identifier only: the previous and new names
 * are personal data and are deliberately not stored.
 */
export async function updateUserName(
  pool: Pool,
  input: {
    userId: string
    organisationId: string | null
    name: string
    requestId: string
  },
): Promise<CurrentUser | null> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const updated = await client['query']<{
      id: string
      email: string
      name: string
      role: UserRole | null
    }>(
      `update users set name = $2, "updatedAt" = now()
       where id = $1 returning id, email, name, role`,
      [input.userId, input.name],
    )
    const row = updated.rows[0]
    if (!row) {
      await client.query('rollback')
      return null
    }
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'user',
      entityId: input.userId,
      action: 'user.profile_update',
      metadata: {},
      requestId: input.requestId,
    })
    await client.query('commit')
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role ?? null,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}
