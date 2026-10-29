import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'bun:test'
import { loadLocalEnvFile } from './local-env.mjs'

const savedNodeEnv = process.env.NODE_ENV
const savedRunner = process.env.OBITER_TEST_RUNNER

afterAll(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = savedNodeEnv
  if (savedRunner === undefined) delete process.env.OBITER_TEST_RUNNER
  else process.env.OBITER_TEST_RUNNER = savedRunner
})

async function envDir(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'obiter-load-env-'))
  await writeFile(join(directory, '.env'), contents)
  return directory
}

function leaveTestRunner(): void {
  process.env.NODE_ENV = 'development'
  delete process.env.OBITER_TEST_RUNNER
}

describe('loadLocalEnvFile outside a test runner', () => {
  it('adds the .env values without overriding what the process already has', async () => {
    leaveTestRunner()
    process.env.OBITER_LOAD_PROBE = 'from-process'
    const directory = await envDir(
      'OBITER_LOAD_PROBE=from-file\nOBITER_LOAD_NEW=from-file\n',
    )

    expect(loadLocalEnvFile(directory)).toBe(join(directory, '.env'))
    expect(process.env.OBITER_LOAD_PROBE).toBe('from-process')
    expect(process.env.OBITER_LOAD_NEW).toBe('from-file')

    await rm(directory, { recursive: true, force: true })
  })

  it('memoizes the first path it resolved for the process', async () => {
    leaveTestRunner()
    const first = await envDir('OBITER_MEMO_FIRST=1\n')
    const second = await envDir('OBITER_MEMO_SECOND=2\n')

    const path = loadLocalEnvFile(first)

    expect(loadLocalEnvFile(second)).toBe(path)
    expect(process.env.OBITER_MEMO_SECOND).toBeUndefined()

    await rm(first, { recursive: true, force: true })
    await rm(second, { recursive: true, force: true })
  })
})
