import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseLocalEnvFile, readNodeEnv, resolveLocalEnvFile } from './index'

describe('resolveLocalEnvFile', () => {
  const tempDirs: string[] = []

  async function tempDir(prefix: string, base = tmpdir()) {
    const directory = await mkdtemp(join(base, prefix))
    tempDirs.push(directory)
    return directory
  }

  // A worktree root, marked the way the real repository marks one.
  async function tempWorktree(base = tmpdir()) {
    const root = await tempDir('obiter-worktree-', base)
    await writeFile(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - services/*\n',
    )
    return root
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('finds the worktree root .env from a nested package', async () => {
    const root = await tempWorktree()
    const nested = join(root, 'services', 'api')
    await mkdir(nested, { recursive: true })
    const envPath = join(root, '.env')
    await writeFile(envPath, 'DATABASE_URL=postgres://lane\n')

    expect(resolveLocalEnvFile(nested)).toBe(envPath)
  })

  it('does not cross the worktree boundary into a parent checkout .env', async () => {
    // The shape of ~/Source/Obiter: a checkout with a .env and a lane worktree
    // nested inside it whose own .env is missing.
    const parent = await tempDir('obiter-parent-')
    await writeFile(join(parent, '.env'), 'DATABASE_URL=postgres://shared\n')

    const worktree = await tempWorktree(parent)
    const nested = join(worktree, 'services', 'api')
    await mkdir(nested, { recursive: true })

    expect(resolveLocalEnvFile(nested)).toBeNull()
  })

  it('returns null when the worktree has no .env', async () => {
    const worktree = await tempWorktree()
    expect(resolveLocalEnvFile(worktree)).toBeNull()
  })

  it('stops at the depth cap when no workspace marker exists', async () => {
    // Six levels below the .env, with no marker anywhere: the walk must not
    // reach the file. Before the marker bound this path walked to /, so a
    // bundled or copied deployment could pick up an unrelated ancestor .env.
    const root = await tempDir('obiter-unbounded-')
    const envPath = join(root, '.env')
    await writeFile(envPath, 'DATABASE_URL=postgres://foreign\n')

    let nested = root
    for (let depth = 0; depth < 6; depth += 1) {
      nested = join(nested, 'd')
    }
    await mkdir(nested, { recursive: true })

    expect(resolveLocalEnvFile(nested)).toBeNull()
  })

  it('still finds an .env within the depth cap when no marker exists', async () => {
    const root = await tempDir('obiter-bounded-')
    const envPath = join(root, '.env')
    await writeFile(envPath, 'DATABASE_URL=postgres://local\n')

    let nested = root
    for (let depth = 0; depth < 4; depth += 1) {
      nested = join(nested, 'd')
    }
    await mkdir(nested, { recursive: true })

    expect(resolveLocalEnvFile(nested)).toBe(envPath)
  })
})

describe('parseLocalEnvFile', () => {
  const tempDirs: string[] = []

  async function writeEnv(contents: string) {
    const directory = await mkdtemp(join(tmpdir(), 'obiter-env-file-'))
    tempDirs.push(directory)
    const envPath = join(directory, '.env')
    await writeFile(envPath, contents)
    return envPath
  }

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  it('parses entries and strips surrounding quotes', async () => {
    const envPath = await writeEnv(
      '# lane configuration\nPORT=8791\nOBITER_WEB_ORIGIN="http://localhost:3004"\n\n',
    )

    expect(Object.fromEntries(parseLocalEnvFile(envPath))).toEqual({
      PORT: '8791',
      OBITER_WEB_ORIGIN: 'http://localhost:3004',
    })
  })

  it('refuses a key assigned more than once', async () => {
    const envPath = await writeEnv(
      'PORT=8791\nOBITER_WEB_PORT=3004\nPORT=8787\n',
    )

    expect(() => parseLocalEnvFile(envPath)).toThrow(/PORT more than once/)
  })

  it('reads a quoted multiline value without treating KEY= inside it as an assignment', async () => {
    // A PEM private key is the real case: the body contains lines that look
    // like assignments, and the value may legitimately be multiline.
    const envPath = await writeEnv(
      'PRIVATE_KEY="-----BEGIN\nKEY=inner\n-----END"\nPORT=8791\n',
    )

    const entries = parseLocalEnvFile(envPath)

    expect(entries.get('PRIVATE_KEY')).toBe('-----BEGIN\nKEY=inner\n-----END')
    expect(entries.has('KEY')).toBe(false)
    expect(entries.get('PORT')).toBe('8791')
  })

  it('still refuses a duplicate after a multiline value', async () => {
    const envPath = await writeEnv('A="x\nB=1\ny"\nB=2\nB=3\n')

    expect(() => parseLocalEnvFile(envPath)).toThrow(/B more than once/)
  })

  it('strips an export prefix and catches an export-prefixed duplicate', async () => {
    const envPath = await writeEnv('export PORT=8791\nPORT=8787\n')

    expect(() => parseLocalEnvFile(envPath)).toThrow(/PORT more than once/)
  })

  it('matches node:util.parseEnv on inline comments and escapes', async () => {
    const envPath = await writeEnv('A=value # comment\nB="x\\ny"\n')

    expect(Object.fromEntries(parseLocalEnvFile(envPath))).toEqual({
      A: 'value',
      B: 'x\ny',
    })
  })
})

describe('readNodeEnv', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('accepts each known mode', () => {
    process.env.NODE_ENV = 'production'
    expect(readNodeEnv()).toBe('production')

    process.env.NODE_ENV = 'test'
    expect(readNodeEnv()).toBe('test')

    process.env.NODE_ENV = 'development'
    expect(readNodeEnv()).toBe('development')
  })

  it('refuses an unknown mode', () => {
    process.env.NODE_ENV = 'staging'

    expect(readNodeEnv).toThrow(
      'NODE_ENV must be production, test, or development; got "staging".',
    )
  })

  it('refuses an unset mode without the local development opt-in', () => {
    delete process.env.NODE_ENV
    delete process.env.OBITER_LOCAL_DEVELOPMENT

    expect(readNodeEnv).toThrow(
      'NODE_ENV must be production, test, or development.',
    )
  })

  it('treats an empty mode as unset and needs the exact opt-in value', () => {
    process.env.NODE_ENV = ''
    process.env.OBITER_LOCAL_DEVELOPMENT = '1'
    expect(readNodeEnv()).toBe('development')

    process.env.OBITER_LOCAL_DEVELOPMENT = 'true'
    expect(readNodeEnv).toThrow(/NODE_ENV must be production/)
  })
})
