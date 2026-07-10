import { hashPassword } from 'better-auth/crypto'
import { Pool } from 'pg'
import { readApiEnv } from '../env'

function usage(): never {
  throw new Error('Usage: OBITER_SEED_PASSWORD=<password> pnpm --filter @obiter/api seed:user -- <email> [organisation name]')
}

const argumentsAfterScript = process.argv.slice(2)
const [email, organisationName = 'Development organisation'] = argumentsAfterScript[0] === '--'
  ? argumentsAfterScript.slice(1)
  : argumentsAfterScript
const password = process.env.OBITER_SEED_PASSWORD

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length < 12) {
  usage()
}

const pool = new Pool({ connectionString: readApiEnv().databaseUrl })
const client = await pool.connect()

try {
  await client.query('begin')
  const existing = await client.query<{ id: string }>('select id from users where email = $1', [email])
  if (existing.rows[0]) {
    throw new Error('A user with this email already exists; provisioning does not alter existing accounts.')
  }

  const organisation = await client.query<{ id: string }>(
    'insert into organisations (name, created_at, updated_at) values ($1, now(), now()) returning id',
    [organisationName],
  )
  const user = await client.query<{ id: string }>(
    `insert into users (name, email, "emailVerified", "organisationId", role, "createdAt", "updatedAt")
      values ($1, $2, true, $3, 'owner', now(), now()) returning id`,
    ['Developer', email, organisation.rows[0].id],
  )
  const passwordHash = await hashPassword(password)
  await client.query(
    `insert into accounts ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values ($1, 'credential', $1, $2, now(), now())`,
    [user.rows[0].id, passwordHash],
  )
  await client.query('commit')
  console.info(`Provisioned ${email} as owner of ${organisation.rows[0].id}.`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
