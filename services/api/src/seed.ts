/**
 * Development seed script.
 *
 * Creates a development dataset (organisation, user, matters, documents) so
 * every live surface in the app shell shows real rows. Run with `pnpm seed`
 * from the repo root against a migrated database.
 *
 * The seeded user is created through the same password-hashing path the real
 * auth API uses (better-auth's scrypt-based `hashPassword`), so it can sign in
 * through the normal sign-in screen. The organisation is provisioned directly
 * (mirroring `provisionOrganisationForNewUser` in auth.ts) so the seeded user
 * has the shape `/api/me` expects: `users.organisationId` + `role = 'owner'`.
 */
import { createHash, randomUUID } from 'node:crypto'
import { readApiEnv } from './env'
import { createPool } from './database'
import { hashPassword } from 'better-auth/crypto'
import type { Pool } from 'pg'

const SEED_USER_EMAIL = 'lex@obiter.dev'
const SEED_USER_PASSWORD = 'obiter-dev'
const SEED_USER_NAME = 'Lex Obiter'
const ORG_NAME = 'Obiter Legal (dev)'

interface SeedMatter {
  name: string
  clientReference: string
  primaryJurisdiction: string
  description: string
  legalDomains: string[]
  documents: Array<{ filename: string; fileType: string; sizeBytes: number }>
}

const SEED_MATTERS: SeedMatter[] = [
  {
    name: 'Hawthorn Holdings reorganisation',
    clientReference: 'HAW-2026-001',
    primaryJurisdiction: 'England & Wales',
    description:
      'Group reorganisation and share-for-share exchange for the Hawthorn Holdings structure.',
    legalDomains: ['corporate'],
    documents: [
      { filename: 'share-purchase-agreement.pdf', fileType: 'application/pdf', sizeBytes: 248320 },
      { filename: 'board-resolution.docx', fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 38912 },
    ],
  },
  {
    name: 'Marlowe v Northbridge Logistics',
    clientReference: 'MLW-2026-014',
    primaryJurisdiction: 'England & Wales',
    description:
      'Commercial dispute over breach of a logistics services agreement; disclosure in progress.',
    legalDomains: ['litigation'],
    documents: [
      { filename: 'claim-particulars.pdf', fileType: 'application/pdf', sizeBytes: 102400 },
    ],
  },
  {
    name: 'Ashford Estate planning',
    clientReference: 'ASH-2026-007',
    primaryJurisdiction: 'England & Wales',
    description: 'Estate planning and trust restructuring for the Ashford family.',
    legalDomains: ['private-client'],
    documents: [],
  },
]

function sha256Of(value: string): string {
  // Deterministic placeholder hash meeting the ^[A-Fa-f0-9]{64}$ column check.
  // Seed data has no real file bytes; this is metadata only.
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

async function seed(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('begin')

    const orgResult = await client.query<{ id: string }>(
      `insert into organisations (name, created_at, updated_at)
       values ($1, now(), now())
       on conflict do nothing
       returning id`,
      [ORG_NAME],
    )

    let organisationId: string
    if (orgResult.rows.length > 0) {
      organisationId = orgResult.rows[0].id
    } else {
      const existing = await client.query<{ id: string }>(
        'select id from organisations where name = $1',
        [ORG_NAME],
      )
      if (existing.rows.length === 0) {
        throw new Error('Could not find or create the seed organisation.')
      }
      organisationId = existing.rows[0].id
    }

    const userId = `usr_${randomUUID()}`
    const passwordHash = await hashPassword(SEED_USER_PASSWORD)
    await client.query(
      `insert into users (id, name, email, "emailVerified", "createdAt", "updatedAt", "organisationId", role)
       values ($1, $2, $3, true, now(), now(), $4, 'owner')
       on conflict (email) do update set
         "organisationId" = excluded."organisationId",
         role = excluded.role,
         "emailVerified" = true,
         "updatedAt" = now()`,
      [userId, SEED_USER_NAME, SEED_USER_EMAIL, organisationId],
    )

    // Ensure the (possibly pre-existing) user row has the canonical id + org.
    const userRow = await client.query<{ id: string }>(
      'select id from users where email = $1',
      [SEED_USER_EMAIL],
    )
    const resolvedUserId = userRow.rows[0].id

    const accountId = `acc_${randomUUID()}`
    await client.query(
      `insert into accounts (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       values ($1, $2, 'credential', $3, $4, now(), now())
       on conflict ("providerId", "accountId") do update set password = excluded.password`,
      [accountId, SEED_USER_EMAIL, resolvedUserId, passwordHash],
    )

    for (const seedMatter of SEED_MATTERS) {
      const matterId = `mtr_${randomUUID()}`
      await client.query(
        `insert into matters
           (id, organisation_id, name, description, primary_jurisdiction,
            secondary_jurisdictions, legal_domains, client_reference, status, created_by,
            created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now(), now())`,
        [
          matterId,
          organisationId,
          seedMatter.name,
          seedMatter.description,
          seedMatter.primaryJurisdiction,
          JSON.stringify([]),
          JSON.stringify(seedMatter.legalDomains),
          seedMatter.clientReference,
          resolvedUserId,
        ],
      )

      for (const doc of seedMatter.documents) {
        const documentId = `doc_${randomUUID()}`
        const versionId = `ver_${randomUUID()}`
        const objectKey = `org/${organisationId}/matters/${matterId}/documents/${documentId}/versions/${versionId}/source`
        const sha = sha256Of(`${doc.filename}:${documentId}:${versionId}`)

        await client.query(
          `insert into matter_documents (id, organisation_id, matter_id, current_version_id, created_by, created_at, updated_at)
           values ($1, $2, $3, $4, $5, now(), now())`,
          [documentId, organisationId, matterId, versionId, resolvedUserId],
        )

        await client.query(
          `insert into document_versions
             (id, organisation_id, matter_id, matter_document_id, filename, file_type, size_bytes,
              object_key, document_status, version_number, content_sha256, sync_state, created_by,
              created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'queued', 1, $9, 'synced', $10, now(), now())`,
          [
            versionId,
            organisationId,
            matterId,
            documentId,
            doc.filename,
            doc.fileType,
            doc.sizeBytes,
            objectKey,
            sha,
            resolvedUserId,
          ],
        )
      }
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  const env = readApiEnv()
  if (env.nodeEnv === 'production') {
    console.error('The seed script must not run in production. Set NODE_ENV=development.')
    process.exit(1)
  }

  const pool = createPool(env)
  try {
    await seed(pool)
    console.log('Seed complete.')
    console.log(`  Organisation: ${ORG_NAME}`)
    console.log(`  User:         ${SEED_USER_EMAIL}`)
    console.log(`  Password:     ${SEED_USER_PASSWORD}`)
    console.log(`  Matters:      ${SEED_MATTERS.length}`)
    console.log(`  Documents:    ${SEED_MATTERS.reduce((n, m) => n + m.documents.length, 0)}`)
    console.log('\nSign in at the app with the credentials above.')
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error('Seed failed:', error)
  process.exit(1)
})
