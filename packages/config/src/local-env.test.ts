import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { loadLocalEnvFile } from './local-env.mjs'

describe('loadLocalEnvFile under a test runner', () => {
  it('reads no .env so a suite never depends on a developer file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'obiter-load-skip-'))
    try {
      await writeFile(join(directory, '.env'), 'OBITER_SKIP_PROBE=loaded\n')
      process.env.OBITER_TEST_RUNNER = '1'

      expect(loadLocalEnvFile(directory)).toBeNull()
      expect(process.env.OBITER_SKIP_PROBE).toBeUndefined()
    } finally {
      delete process.env.OBITER_TEST_RUNNER
      await rm(directory, { recursive: true, force: true })
    }
  })
})
