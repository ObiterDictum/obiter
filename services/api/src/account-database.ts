import type { Pool } from 'pg'
import type { CurrentUser, UserRole } from '@obiter/contracts'
import { appendAuditLog } from './audit-log'

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
