import type { Pool } from 'pg'
import {
  PERSONAL_WORKSPACE_NAME,
  parseOrganisationName,
  type CurrentOrganisation,
  type CurrentUser,
  type UserRole,
} from '@obiter/contracts'
import { appendAuditLog } from './audit-log'
import type { SessionUserRecord } from './database-records'

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

export async function createOrganisationForUser(
  pool: Pool,
  input: { userId: string; name?: string; requestId: string },
): Promise<
  | {
      created: false
      organisationId: string
      role: UserRole
    }
  | { created: true; organisation: CurrentOrganisation }
> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    const existing = await client['query']<{
      organisationId: string | null
      role: UserRole | null
      pendingOrganisationName: string | null
    }>(
      `select "organisationId", role, "pendingOrganisationName" from users where id = $1 for update`,
      [input.userId],
    )
    if (existing.rows.length === 0) {
      await client.query('rollback')
      throw new Error('User record not found.')
    }
    const current = existing.rows[0]
    const currentOrgId = current?.organisationId
    if (currentOrgId) {
      if (current?.pendingOrganisationName) {
        await client['query'](
          `update users set "pendingOrganisationName" = null, "updatedAt" = now() where id = $1`,
          [input.userId],
        )
        await client.query('commit')
      } else {
        await client.query('rollback')
      }
      return {
        created: false,
        organisationId: currentOrgId,
        role: current.role ?? 'member',
      }
    }

    const stashed = parseOrganisationName(
      current?.pendingOrganisationName ?? '',
    )
    const name =
      input.name ?? (stashed.ok ? stashed.name : PERSONAL_WORKSPACE_NAME)

    const organisation = await client['query']<{
      id: string
      name: string
      plan: CurrentOrganisation['plan']
    }>(
      `
        insert into organisations (name, created_at, updated_at)
        values ($1, now(), now())
        returning id, name, plan
      `,
      [name],
    )
    const created = organisation.rows[0]

    await client['query'](
      `update users set "organisationId" = $1, role = 'owner', "pendingOrganisationName" = null, "updatedAt" = now() where id = $2`,
      [created.id, input.userId],
    )

    await appendAuditLog(client, {
      organisationId: created.id,
      userId: input.userId,
      entityType: 'organisation',
      entityId: created.id,
      action: 'organisation.create',
      metadata: { name },
      requestId: input.requestId,
    })

    await client.query('commit')
    return { created: true, organisation: created }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function ensureOrganisationForUser(
  pool: Pool,
  input: { userId: string; requestId: string },
): Promise<{ organisationId: string; role: UserRole; created: boolean }> {
  const result = await createOrganisationForUser(pool, {
    userId: input.userId,
    requestId: input.requestId,
  })
  if (result.created) {
    return {
      organisationId: result.organisation.id,
      role: 'owner',
      created: true,
    }
  }
  return {
    organisationId: result.organisationId,
    role: result.role,
    created: false,
  }
}

export async function renameOrganisation(
  pool: Pool,
  input: {
    organisationId: string
    userId: string
    name: string
    requestId: string
  },
): Promise<{ organisation: CurrentOrganisation; renamed: boolean } | null> {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const current = await client['query']<{
      id: string
      name: string
      plan: CurrentOrganisation['plan']
    }>(`select id, name, plan from organisations where id = $1 for update`, [
      input.organisationId,
    ])
    const row = current.rows[0]
    if (!row) {
      await client.query('rollback')
      return null
    }
    if (row.name === input.name) {
      await client.query('commit')
      return { organisation: row, renamed: false }
    }
    const updated = await client['query']<{
      id: string
      name: string
      plan: CurrentOrganisation['plan']
    }>(
      `update organisations set name = $2, updated_at = now()
       where id = $1 returning id, name, plan`,
      [input.organisationId, input.name],
    )
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'organisation',
      entityId: input.organisationId,
      action: 'organisation.rename',
      metadata: { previousName: row.name, name: input.name },
      requestId: input.requestId,
    })
    await client.query('commit')
    return { organisation: updated.rows[0], renamed: true }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export function toCurrentUser(user: SessionUserRecord): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? null,
  }
}
