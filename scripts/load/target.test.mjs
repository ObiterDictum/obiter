import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  TargetRefusal,
  assertLoopbackOrigin,
  databaseNameFromUrl,
  expectedLaneDatabase,
  readEnvAssignment,
  resolveLoadTarget,
} from './target.mjs'

const scratch = await mkdtemp(join(tmpdir(), 'q3-target-test-'))
afterAll(() => rm(scratch, { recursive: true, force: true }))

/** A lane-shaped worktree whose `.env` is the only source of its ports. */
async function laneWorktree(name, env = {}) {
  const root = join(scratch, name)
  await mkdir(root, { recursive: true })
  const lines = Object.entries({
    PORT: '8791',
    OBITER_WEB_PORT: '3004',
    OBITER_API_ORIGIN: 'http://localhost:8791',
    DATABASE_URL:
      'postgresql://obiter:secret@localhost:5432/obiter_lane_security',
    ...env,
  }).map(([key, value]) => `${key}="${value}"`)
  const envFile = join(root, '.env')
  await writeFile(envFile, `${lines.join('\n')}\n`)
  return { root, envFile }
}

function healthResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      status: 'ok',
      service: 'obiter-api',
      provenance: {
        checkoutRoot: overrides.checkoutRoot,
        commitSha: overrides.commitSha ?? 'abc123',
        envFile: overrides.envFile,
      },
    }),
  }
}

async function resolveFor(root, envFile, { fetchImpl, ...rest } = {}) {
  return resolveLoadTarget({
    worktreeRoot: root,
    processEnv: {},
    fetchImpl:
      fetchImpl ??
      (async () => healthResponse({ checkoutRoot: root, envFile })),
    ...rest,
  })
}

describe('lane database naming', () => {
  it('derives the database from the lane folder', () => {
    expect(expectedLaneDatabase('/home/karl/Source/Obiter/lane-security')).toBe(
      'obiter_lane_security',
    )
    expect(expectedLaneDatabase('/home/karl/Source/Obiter/lane-verify')).toBe(
      'obiter_lane_verify',
    )
  })

  it('refuses a checkout that is not a lane', () => {
    expect(() =>
      expectedLaneDatabase('/home/karl/Source/Obiter/obiter-live'),
    ).toThrow(TargetRefusal)
  })

  it('reads the database name out of a connection URL', () => {
    expect(
      databaseNameFromUrl(
        'postgresql://u:p@localhost:5432/obiter_lane_security',
      ),
    ).toBe('obiter_lane_security')
    expect(
      databaseNameFromUrl(
        'postgres://u:p@db.internal:5432/obiter?sslmode=require',
      ),
    ).toBe('obiter')
  })

  it('refuses a URL that names no database', () => {
    expect(() =>
      databaseNameFromUrl('postgresql://u:p@localhost:5432/'),
    ).toThrow(TargetRefusal)
    expect(() => databaseNameFromUrl('not a url')).toThrow(TargetRefusal)
  })
})

describe('env resolution', () => {
  it('prefers the process environment, matching the API loader', () => {
    expect(
      readEnvAssignment('DATABASE_URL=x\n', 'DATABASE_URL', {
        DATABASE_URL: 'y',
      }),
    ).toBe('y')
  })

  it('reads a quoted value and ignores comments and absent keys', () => {
    const text = [
      '# comment',
      'PORT="8791"',
      "OTHER='z'",
      '',
      'PORT=9999',
    ].join('\n')
    expect(readEnvAssignment(text, 'PORT', {})).toBe('8791')
    expect(readEnvAssignment(text, 'OTHER', {})).toBe('z')
    expect(readEnvAssignment(text, 'MISSING', {})).toBeNull()
  })
})

describe('loopback targeting', () => {
  it.each([
    'http://127.0.0.1:8791',
    'http://localhost:8791',
    'http://[::1]:8791',
  ])('accepts %s', (origin) =>
    expect(() => assertLoopbackOrigin(origin)).not.toThrow(),
  )

  it.each([
    'http://0.0.0.0:8787',
    'https://api.obiter.dev',
    'http://10.0.0.5:8791',
  ])('refuses %s', (origin) =>
    expect(() => assertLoopbackOrigin(origin)).toThrow(TargetRefusal),
  )
})

describe('resolveLoadTarget', () => {
  it('proves the whole chain for a lane target', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    const target = await resolveFor(root, envFile)
    expect(target.apiOrigin).toBe('http://localhost:8791')
    expect(target.databaseName).toBe('obiter_lane_security')
    expect(target.envFile).toBe(envFile)
    expect(target.commitSha).toBe('abc123')
  })

  it('refuses the shared API port', async () => {
    const { root, envFile } = await laneWorktree('lane-security', {
      PORT: '8787',
    })
    await expect(resolveFor(root, envFile)).rejects.toThrow(/shared dev ports/)
  })

  it('refuses a database that is not this lane', async () => {
    const { root, envFile } = await laneWorktree('lane-security', {
      DATABASE_URL:
        'postgresql://obiter:secret@localhost:5432/obiter_lane_search',
    })
    await expect(resolveFor(root, envFile)).rejects.toThrow(
      /obiter_lane_search/,
    )
  })

  it('accepts a non-derived database only when it is named exactly', async () => {
    const { root, envFile } = await laneWorktree('lane-security', {
      DATABASE_URL:
        'postgresql://obiter:secret@localhost:5432/obiter_lane_security_test',
    })
    await expect(resolveFor(root, envFile)).rejects.toThrow(TargetRefusal)
    const target = await resolveFor(root, envFile, {
      allowDatabase: 'obiter_lane_security_test',
    })
    expect(target.databaseName).toBe('obiter_lane_security_test')
    expect(target.databaseSource).toBe('explicit-flag')
  })

  it('refuses an API serving another checkout', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    await expect(
      resolveFor(root, envFile, {
        fetchImpl: async () =>
          healthResponse({
            checkoutRoot: '/home/karl/Source/Obiter/lane-editor',
            envFile,
          }),
      }),
    ).rejects.toThrow(/serves \/home\/karl\/Source\/Obiter\/lane-editor/)
  })

  it('refuses an API running a different commit', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    await expect(
      resolveFor(root, envFile, {
        expectCommit: 'deadbeef',
        fetchImpl: async () =>
          healthResponse({ checkoutRoot: root, envFile, commitSha: 'abc123' }),
      }),
    ).rejects.toThrow(/expects deadbeef/)
  })

  it('refuses an API configured from a different .env', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    await expect(
      resolveFor(root, envFile, {
        fetchImpl: async () =>
          healthResponse({ checkoutRoot: root, envFile: '/tmp/other/.env' }),
      }),
    ).rejects.toThrow(/resolved its configuration from/)
  })

  it('refuses an API that reports no provenance', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    await expect(
      resolveFor(root, envFile, {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok' }),
        }),
      }),
    ).rejects.toThrow(/no development provenance/)
  })

  it('refuses an unreachable API', async () => {
    const { root, envFile } = await laneWorktree('lane-security')
    await expect(
      resolveFor(root, envFile, {
        fetchImpl: async () => {
          throw new Error('ECONNREFUSED')
        },
      }),
    ).rejects.toThrow(/did not answer \/api\/health/)
  })
})
