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
  identity('oldsha')
  await writeBuildProvenance(dir, { repoRoot: dir })
  await assert.rejects(
    () => verifyBuildProvenance(dir, { expectCommit: 'newsha' }),
    /artifact commit is oldsha, expected newsha/,
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
