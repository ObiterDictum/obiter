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

/**
 * Creates an organisation, assigns the creating user to it as owner, clears
 * any stashed sign-up organisation name, and writes the audit row — all in
 * one transaction. The single-org invariant is enforced in code here: the
 * user row is locked with SELECT ... FOR UPDATE and the function rejects
 * (returns `{ created: false }`, 409 in the route) if the user already has
 * an organisationId. No DB-level unique constraint backs this — a per-user
 * index would be wrong (it would allow distinct organisations per user
 * rather than serialising the same-user race, and a
 * one-organisation-per-user index would block future multi-member orgs).
 * The row lock serialises concurrent creation for the same user.
 *
 * The name is explicit when given (POST /api/organisations, Settings
 * rename path never reaches here). When omitted (first-use
 * auto-provisioning), the stashed sign-up name is consumed in place of the
 * default workspace name — it lives on the user row, so verification on a
 * different device still provisions the typed name. A missing or invalid
 * stash (forged over-long/invisible value, pre-stash account) falls back
 * to the default; the stash is cleared either way so it is single-use.
 *
 * If the user row is missing entirely, the function rolls back and throws
 * so the caller surfaces a 500 rather than inserting an orphan organisation
 * + audit row. Any other failure likewise throws.
 *
 * When the user already has an organisation, returns `{ created: false,
 * organisationId, role }` so callers that auto-provision (matters/redact)
 * can continue with the existing tenant without a second lookup. A stale
 * stash there is cleared too, so a pending name never lingers once the
 * user belongs to an organisation.
 */
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
      // No user row: a data-integrity failure, not the normal org-less state.
      // Fail closed rather than inserting an organisation nothing references.
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

    // Explicit names win (the route validates before reaching here); the
    // stash is validated with the same shared rule and falls back to the
    // default when absent or forged.
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

/**
 * Ensures the user has an organisation for tenant-scoped product data.
 * Creates the tenant with the stashed sign-up name when present, else a
 * personal workspace; otherwise returns the existing organisation. Used by
 * Matters/Documents/Redact auth helpers so product surfaces work without a
 * prior Settings visit.
 */
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

/**
 * Renames an organisation and writes the audit row in one transaction.
 * Returns null when the organisation does not exist so the caller can
 * surface a 404 without writing an audit row (no existence leak).
 * A no-op rename (same name) still succeeds without an audit row.
 */
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

// An org-less user has role null; /api/me returns them with organisation null
// so the client can offer optional organisation setup in Settings.
export function toCurrentUser(user: SessionUserRecord): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role ?? null,
  }
}
