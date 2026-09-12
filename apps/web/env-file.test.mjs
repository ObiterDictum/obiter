import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { assertNoDuplicateEnvKeys } from './env-file.mjs'

const tempDirs = []

async function writeEnv(contents) {
  const directory = await mkdtemp(join(tmpdir(), 'obiter-web-env-'))
  tempDirs.push(directory)
  const envPath = join(directory, '.env')
  await writeFile(envPath, contents)
  return envPath
}

after(async () => {
  await Promise.all(
    tempDirs.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

test('accepts a file whose keys are unique', async () => {
  const envPath = await writeEnv('PORT=3004\nOBITER_WEB_PORT=3004\n')
  assert.doesNotThrow(() => assertNoDuplicateEnvKeys(envPath))
})

test('refuses a key assigned more than once', async () => {
  const envPath = await writeEnv('OBITER_WEB_PORT=3004\nOBITER_WEB_PORT=3001\n')
  assert.throws(
    () => assertNoDuplicateEnvKeys(envPath),
    /OBITER_WEB_PORT more than once/,
  )
})

test('ignores a commented key and blank lines', async () => {
  const envPath = await writeEnv('# PORT=3000\n\nPORT=3004\n')
  assert.doesNotThrow(() => assertNoDuplicateEnvKeys(envPath))
})

test('ignores a file that does not exist', () => {
  assert.doesNotThrow(() =>
    assertNoDuplicateEnvKeys('/nonexistent/obiter-config/.env'),
  )
})
