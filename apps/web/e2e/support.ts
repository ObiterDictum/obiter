import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Reuse the synthetic fixture already in the repo — fictional names only.
const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'

export function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

export function verifyEmailInDb(databaseName: string, email: string) {
  // Mark the better-auth user as verified so sign-in succeeds (requireEmailVerification=true).
  const safe = email.replace(/'/g, "''")
  const sql = `update users set "emailVerified"=true where email='${safe}'`
  // The API's database is whatever DATABASE_URL points at, and the Playwright
  // config starts the API from OBITER_E2E_DATABASE_URL. The caller resolves
  // this name from that same variable (refusing the shared `obiter` database),
  // so sign-up, verification and sign-in land in one database.
  execFileSync(
    'docker',
    [
      'exec',
      'obiter-postgres',
      'psql',
      '-U',
      'obiter',
      '-d',
      databaseName,
      '-c',
      sql,
    ],
    { stdio: 'pipe' },
  )
}
