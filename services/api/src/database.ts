import { Pool } from 'pg'
import type { CurrentOrganisation, CurrentUser, UserRole } from '@ormont/contracts'
import type { ApiEnv } from './env'

export interface SessionUserRecord {
  id: string
  email: string
  name: string
  organisationId?: string | null
  role?: UserRole | null
}

export interface AuditRecordInput {
  organisationId: string
  userId: string | null
  entityType: string
  entityId: string
  action: 'auth.sign_in' | 'auth.sign_out'
  metadata: Record<string, string | number | boolean | null>
  requestId: string
}

export function createPool(env: ApiEnv) {
  return new Pool({
    connectionString: env.databaseUrl,
  })
}

export async function findOrganisation(
  pool: Pool,
  organisationId: string,
): Promise<CurrentOrganisation | null> {
  const result = await pool.query<{
    id: string
    name: string
    plan: CurrentOrganisation['plan']
  }>(
    `
      select id, name, plan
      from organisations
      where id = $1
    `,
    [organisationId],
  )

  return result.rows[0] ?? null
}

export function toCurrentUser(user: SessionUserRecord): CurrentUser | null {
  if (!user.role) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  }
}

export async function appendAuditLog(pool: Pool, input: AuditRecordInput) {
  await pool.query(
    `
      insert into audit_logs (
        id,
        organisation_id,
        user_id,
        entity_type,
        entity_id,
        action,
        metadata_json,
        request_id,
        created_at
      )
      values (
        gen_random_uuid()::text,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7,
        now()
      )
    `,
    [
      input.organisationId,
      input.userId,
      input.entityType,
      input.entityId,
      input.action,
      JSON.stringify(input.metadata),
      input.requestId,
    ],
  )
}
