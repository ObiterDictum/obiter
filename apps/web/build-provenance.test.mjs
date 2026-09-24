/*
 * Tests for the build marker written into dist/ and verified at serve time and
 * by the measurement harness. These cover the failures the marker exists to
 * refuse: a missing marker, a dist modified after the build, a stale commit, a
 * dirty build presented as clean, and a development React artifact.
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  MARKER_FILE,
  MARKER_SCHEMA,
  readBuildProvenance,
  verifyArtifactIntegrity,
  verifyBuildProvenance,
  writeBuildProvenance,
} from './build-provenance.mjs'

const tempDirs = []
const savedEnv = {
  commit: process.env.OBITER_BUILD_COMMIT,
  dirty: process.env.OBITER_BUILD_DIRTY,
}

after(async () => {
  if (savedEnv.commit === undefined) delete process.env.OBITER_BUILD_COMMIT
  else process.env.OBITER_BUILD_COMMIT = savedEnv.commit
  if (savedEnv.dirty === undefined) delete process.env.OBITER_BUILD_DIRTY
  else process.env.OBITER_BUILD_DIRTY = savedEnv.dirty
  await Promise.all(
    tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

/** A minimal built dist: two content-hashed client assets. */
async function fixtureDist() {
  const dir = await mkdtemp(join(tmpdir(), 'obiter-provenance-'))
  tempDirs.push(dir)
  await mkdir(join(dir, 'client', 'assets'), { recursive: true })
  await writeFile(
    join(dir, 'client', 'assets', 'index-abcdefgh.js'),
    'export const x = 1\n',
  )
  await writeFile(
    join(dir, 'client', 'assets', 'styles-ijklmnop.css'),
    'body{}\n',
  )
  return dir
}

function identity(commit = 'abc1234', dirty = '0') {
  process.env.OBITER_BUILD_COMMIT = commit
  process.env.OBITER_BUILD_DIRTY = dirty
}

test('writeBuildProvenance records what was built', async () => {
  const dir = await fixtureDist()
  identity()
  const marker = await writeBuildProvenance(dir, { repoRoot: dir })
  assert.equal(marker.schema, MARKER_SCHEMA)
  assert.equal(marker.commit, 'abc1234')
  assert.equal(marker.dirty, false)
  assert.equal(marker.commitSource, 'env')
  assert.equal(marker.reactProduction, true)
  assert.equal(marker.assetCount, 2)
  assert.deepEqual(marker.hashedAssets, [
    'index-abcdefgh.js',
    'styles-ijklmnop.css',
  ])
  assert.match(marker.integrity, /^sha256-/)
  const written = JSON.parse(await readFile(join(dir, MARKER_FILE), 'utf8'))
  assert.deepEqual(written, marker)
})

test('verifyBuildProvenance accepts a matching clean production artifact', async () => {
  const dir = await fixtureDist()
  identity()
  await writeBuildProvenance(dir, { repoRoot: dir })
  const marker = await verifyBuildProvenance(dir, { expectCommit: 'abc1234' })
  assert.equal(marker.commit, 'abc1234')
})

test('a missing marker is refused', async () => {
  const dir = await fixtureDist()
  assert.equal(await readBuildProvenance(dir), null)
  await assert.rejects(
    () => verifyArtifactIntegrity(dir),
    /no build provenance/,
  )
})

test('a dist modified after the build is refused', async () => {
  const dir = await fixtureDist()
  identity()
  await writeBuildProvenance(dir, { repoRoot: dir })
  await writeFile(
    join(dir, 'client', 'assets', 'index-abcdefgh.js'),
    'tampered\n',
  )
  await assert.rejects(
    () => verifyArtifactIntegrity(dir),
    /modified after build/,
  )
})

test('a stale commit is refused', async () => {
  const dir = await fixtureDist()
  identity('a'.repeat(40))
  await writeBuildProvenance(dir, { repoRoot: dir })
  await assert.rejects(
    () => verifyBuildProvenance(dir, { expectCommit: 'b'.repeat(40) }),
    /artifact commit is a{40}, expected b{40}/,
  )
})

test('a dirty build is refused unless explicitly allowed', async () => {
  const dir = await fixtureDist()
  identity('abc1234', '1')
  await writeBuildProvenance(dir, { repoRoot: dir })
  await assert.rejects(
    () => verifyBuildProvenance(dir, { expectCommit: 'abc1234' }),
    /not a clean build/,
  )
  const marker = await verifyBuildProvenance(dir, {
    expectCommit: 'abc1234',
    requireClean: false,
  })
  assert.equal(marker.dirty, true)
})

test('a development React build is refused', async () => {
  const dir = await fixtureDist()
  identity()
  await writeFile(
    join(dir, 'client', 'assets', 'dev-zyxwvuts.js'),
    'import {jsxDEV} from "react/jsx-dev-runtime"\n',
  )
  const marker = await writeBuildProvenance(dir, { repoRoot: dir })
  assert.equal(marker.reactProduction, false)
  await assert.rejects(
    () => verifyBuildProvenance(dir, { expectCommit: 'abc1234' }),
    /not compiled with production React/,
  )
})

test('a malformed OBITER_BUILD_COMMIT is refused', async () => {
  const dir = await fixtureDist()
  identity('not-a-sha', '0')
  await assert.rejects(
    () => writeBuildProvenance(dir, { repoRoot: dir }),
    /OBITER_BUILD_COMMIT is not a git commit SHA/,
  )
})

test('a malformed OBITER_BUILD_DIRTY is refused', async () => {
  const dir = await fixtureDist()
  identity('abc1234', 'maybe')
  await assert.rejects(
    () => writeBuildProvenance(dir, { repoRoot: dir }),
    /OBITER_BUILD_DIRTY must be 0\/1\/true\/false/,
  )
})

test('missing inputs with no git record null and the harness refuses them', async () => {
  const dir = await fixtureDist()
  delete process.env.OBITER_BUILD_COMMIT
  delete process.env.OBITER_BUILD_DIRTY
  const marker = await writeBuildProvenance(dir, { repoRoot: dir })
  assert.equal(marker.commit, null)
  assert.equal(marker.commitSource, 'unknown')
  assert.equal(marker.dirty, null)
  await assert.rejects(
    () => verifyBuildProvenance(dir, { expectCommit: 'abc1234' }),
    /artifact commit is unknown, expected abc1234/,
  )
})

test('the Dockerfile passes both provenance args into the web build', async () => {
  const dockerfile = await readFile(
    new URL('./Dockerfile', import.meta.url),
    'utf8',
  )
  assert.match(dockerfile, /ARG OBITER_BUILD_COMMIT/)
  assert.match(dockerfile, /ARG OBITER_BUILD_DIRTY/)
  // Join line continuations so the whole RUN is one logical line.
  const buildLine = dockerfile
    .replace(/\\\n\s*/g, ' ')
    .split('\n')
    .find(
      (line) =>
        line.includes('RUN') &&
        line.includes('bun --bun run --filter @obiter/web build'),
    )
  assert.ok(buildLine, 'the Dockerfile must run the web build')
  assert.match(buildLine, /OBITER_BUILD_COMMIT="\$OBITER_BUILD_COMMIT"/)
  assert.match(buildLine, /OBITER_BUILD_DIRTY="\$OBITER_BUILD_DIRTY"/)
})

test('CI passes both provenance args to the image build', async () => {
  const ci = await readFile(
    new URL('../../.github/workflows/ci.yml', import.meta.url),
    'utf8',
  )
  const step = ci.slice(ci.indexOf('- name: Build apps/web image'))
  assert.match(step, /--build-arg OBITER_BUILD_COMMIT="\$GITHUB_SHA"/)
  assert.match(step, /--build-arg OBITER_BUILD_DIRTY=0/)
})

test('the deployment spec documents both provenance args', async () => {
  const docs = await readFile(
    new URL('../../docs/specs/deployment.md', import.meta.url),
    'utf8',
  )
  assert.match(docs, /OBITER_BUILD_COMMIT/)
  assert.match(docs, /OBITER_BUILD_DIRTY/)
})
