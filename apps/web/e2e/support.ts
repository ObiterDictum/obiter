import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'

export function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

export function verifyEmailInDb(databaseName: string, email: string) {
  const safe = email.replace(/'/g, "''")
  const sql = `update users set "emailVerified"=true where email='${safe}'`
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
