import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

import { buildOoxmlFixture } from '../../packages/ooxml/fixtures/builder'
import { parseDocx } from '../../packages/ooxml/src/parse'
import { createOpaquePart } from '../../packages/ooxml/src/parts/opaque'
import { serialiseDocx } from '../../packages/ooxml/src/serialise'
import { resolveLocalEnvFile } from '../../packages/config/src/local-env.mjs'
import { headSha, WORKTREE_ROOT } from '../../apps/web/lane-target.mjs'
import { isolatedOrigin, resolveLane, testDatabaseName } from './lane'
import { sha256 } from './manifest'
import { documentBodyText } from './summary'
import { inspectWordOutput, wordRecord, type WordEvidence } from './word-step'

const encoder = new TextEncoder()

/** The reason a rejected verdict carries; undefined on any other verdict. */
function rejectedReason(evidence: WordEvidence) {
  return evidence.status === 'rejected' ? evidence.reason : undefined
}

function appXml(application: string | null) {
  return `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">${
    application === null ? '' : `<Application>${application}</Application>`
  }<AppVersion>16.0000</AppVersion></Properties>`
}

/** A serialised copy of the fixture, optionally carrying a doctored app.xml. */
async function docxWithApplication(application: string | null | undefined) {
  const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const doc = await parseDocx(fixture)
  if (application !== undefined) {
    doc.sourceParts.set(
      'docProps/app.xml',
      createOpaquePart(
        'docProps/app.xml',
        'xml',
        encoder.encode(appXml(application)),
      ),
    )
  }
  return { fixture, bytes: await serialiseDocx(doc) }
}

async function knownFor(bytes: Uint8Array) {
  return {
    fixtureSha256: 'unmatched-fixture',
    cycle1Sha256: 'unmatched-cycle1',
    cycle1BodyText: documentBodyText(await parseDocx(bytes)),
  }
}

describe('word-roundtrip lane targets', () => {
  it('refuses the shared dev ports on either origin', () => {
    expect(() => isolatedOrigin('http://127.0.0.1:8787', 'API')).toThrow(
      /shared dev stack/,
    )
    expect(() => isolatedOrigin('http://localhost:3000', 'Web')).toThrow(
      /shared dev stack/,
    )
  })

  it('refuses non-loopback hosts', () => {
    expect(() => isolatedOrigin('https://api.example.com', 'API')).toThrow(
      /loopback/,
    )
  })

  it('accepts an isolated loopback origin', () => {
    expect(isolatedOrigin('http://127.0.0.1:8797', 'API').origin).toBe(
      'http://127.0.0.1:8797',
    )
  })

  it('requires a *_test database and refuses the shared one', () => {
    expect(() => testDatabaseName(undefined)).toThrow(/--db-name/)
    expect(() => testDatabaseName('obiter')).toThrow(/shared dev database/)
    expect(() => testDatabaseName('obiter_e0')).toThrow(/_test/)
    expect(testDatabaseName('obiter_e0_test')).toBe('obiter_e0_test')
  })
})

/*
 * The composition R1 added: the attestation that turns a lane argument into
 * a refusal before any account or document exists. The HTTP boundary is
 * faked — the same seam verifyServedCheckout exposes — while the worktree,
 * HEAD and .env resolution run for real, so a regression in the comparison
 * itself fails here.
 */
const LANE_API = 'http://127.0.0.1:8797'
const LANE_WEB = 'http://localhost:3005'
const LANE_DB = 'obiter_e0_test'
// These tests prove this checkout's lane rules; a tree without git metadata
// cannot run them at all.
const HEAD = headSha(WORKTREE_ROOT)
if (!HEAD) throw new Error('word-roundtrip tests require a git checkout')

type HealthBody =
  | 'valid'
  | 'wrong-database'
  | 'no-database'
  | 'no-provenance'
  | 'null-body'
  | 'string-body'
  | 'stale-sha'
  | 'foreign-checkout'

/**
 * Fake lane servers. `health` answers /api/health on every call; `secondHealth`
 * answers the second call (the database attestation after the checkout proof),
 * so a server that drops or mutates between the two reads is covered.
 */
function fakeLaneServers({
  health = 'valid' as HealthBody,
  secondHealth,
  fetched,
}: {
  health?: HealthBody
  secondHealth?: HealthBody
  fetched: string[]
}) {
  const envFile = resolveLocalEnvFile(WORKTREE_ROOT)
  let healthCalls = 0
  const provenance = (kind: HealthBody) => {
    if (kind === 'no-provenance') return { status: 'ok' }
    if (kind === 'null-body') return null
    if (kind === 'string-body') return 'not a health body'
    return {
      status: 'ok',
      service: 'obiter-api',
      provenance: {
        checkoutRoot:
          kind === 'foreign-checkout'
            ? '/home/karl/Source/Obiter/obiter-live'
            : WORKTREE_ROOT,
        commitSha: kind === 'stale-sha' ? 'b'.repeat(40) : HEAD,
        envFile,
        ...(kind === 'no-database' ? {} : { databaseName: LANE_DB }),
        ...(kind === 'wrong-database' ? { databaseName: 'shared_live' } : {}),
      },
    }
  }
  return async (url: string | URL | Request) => {
    const target = String(url)
    fetched.push(target)
    if (target.endsWith('/api/health')) {
      healthCalls += 1
      const kind = healthCalls === 1 ? health : (secondHealth ?? health)
      const body = provenance(kind)
      return new Response(body === null ? 'null' : JSON.stringify(body), {
        status: 200,
      })
    }
    // Vite dev module candidates: embedded absolute paths inside this
    // worktree prove the web server serves this checkout.
    return new Response(
      `/@fs${WORKTREE_ROOT}/packages/app-shell/src/index.ts\n` +
        `${WORKTREE_ROOT}/apps/web/src/routes/__root.tsx\n`,
      { status: 200 },
    )
  }
}

function laneInput() {
  return { api: LANE_API, web: LANE_WEB, dbName: LANE_DB }
}

describe('word-roundtrip resolveLane composition', () => {
  it('resolves a lane whose servers attest to this checkout and database', async () => {
    const fetched: string[] = []
    const lane = await resolveLane(laneInput(), {
      fetchImpl: fakeLaneServers({ fetched }),
    })
    expect(lane.apiOrigin).toBe(LANE_API)
    expect(lane.webOrigin).toBe(LANE_WEB)
    expect(lane.databaseName).toBe(LANE_DB)
    expect(lane.headSha).toBe(HEAD)
    expect(lane.api.commitSha).toBe(HEAD)
    expect(lane.api.checkoutRoot).toBe(WORKTREE_ROOT)
  })

  it('refuses when the API reports a different bound database', async () => {
    const fetched: string[] = []
    await expect(
      resolveLane(laneInput(), {
        fetchImpl: fakeLaneServers({
          health: 'wrong-database',
          fetched,
        }),
      }),
    ).rejects.toThrow(/bound to database "shared_live", not --db-name/)
    assertNoMutation(fetched)
  })

  it('refuses when the API reports no bound database', async () => {
    const fetched: string[] = []
    await expect(
      resolveLane(laneInput(), {
        fetchImpl: fakeLaneServers({
          health: 'no-database',
          fetched,
        }),
      }),
    ).rejects.toThrow(/bound to database "unknown"/)
    assertNoMutation(fetched)
  })

  it('refuses cleanly on a null, malformed or provenance-free health body', async () => {
    for (const kind of ['null-body', 'string-body', 'no-provenance'] as const) {
      const fetched: string[] = []
      await expect(
        resolveLane(laneInput(), {
          fetchImpl: fakeLaneServers({ health: kind, fetched }),
        }),
      ).rejects.toThrow(/reported no development provenance/)
      assertNoMutation(fetched)
    }
  })

  it('refuses when the database attestation drops between checks', async () => {
    const fetched: string[] = []
    await expect(
      resolveLane(laneInput(), {
        fetchImpl: fakeLaneServers({
          health: 'valid',
          secondHealth: 'null-body',
          fetched,
        }),
      }),
    ).rejects.toThrow(/bound to database "unknown"/)
    assertNoMutation(fetched)
  })

  it('refuses a stale API commit or a foreign checkout before mutating', async () => {
    const stale: string[] = []
    await expect(
      resolveLane(laneInput(), {
        fetchImpl: fakeLaneServers({
          health: 'stale-sha',
          fetched: stale,
        }),
      }),
    ).rejects.toThrow(/is running b{40} but this worktree is at/)

    const foreign: string[] = []
    await expect(
      resolveLane(laneInput(), {
        fetchImpl: fakeLaneServers({
          health: 'foreign-checkout',
          fetched: foreign,
        }),
      }),
    ).rejects.toThrow(/serves .*obiter-live, not this worktree/)

    for (const fetched of [stale, foreign]) assertNoMutation(fetched)
  })

  it('refuses the shared database name before any server is contacted', async () => {
    const fetched: string[] = []
    await expect(
      resolveLane(
        { api: LANE_API, web: LANE_WEB, dbName: 'obiter' },
        { fetchImpl: fakeLaneServers({ fetched }) },
      ),
    ).rejects.toThrow(/shared dev database/)
    expect(fetched).toEqual([])
  })
})

/**
 * The refusal must precede every mutating call: sign-up, psql verification,
 * matter and document writes all happen after resolveLane returns, so a
 * refused run may only ever have asked for health and the web modules the
 * checkout proof reads.
 */
function assertNoMutation(fetched: string[]) {
  for (const url of fetched) {
    expect(url).toMatch(/\/api\/health$|\/src\/routes\//)
  }
}

describe('word-roundtrip Word producer evidence', () => {
  it('rejects the input fixture passed back as the Word output', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const evidence = await inspectWordOutput(fixture, {
      fixtureSha256: sha256(fixture),
      cycle1Sha256: 'other',
      cycle1BodyText: 'whatever',
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('input fixture')
  })

  it('rejects the cycle-1 export passed back as the Word output', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-without-w14-ids')
    const evidence = await inspectWordOutput(fixture, {
      fixtureSha256: 'other',
      cycle1Sha256: sha256(fixture),
      cycle1BodyText: 'whatever',
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('cycle-1')
  })

  it('rejects a package with no docProps/app.xml', async () => {
    const { fixture, bytes } = await docxWithApplication(undefined)
    const evidence = await inspectWordOutput(bytes, {
      ...(await knownFor(bytes)),
      fixtureSha256: sha256(fixture),
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('docProps/app.xml')
  })

  it('rejects a non-Word producer (LibreOffice)', async () => {
    const { fixture, bytes } = await docxWithApplication('LibreOffice/24.2')
    const evidence = await inspectWordOutput(bytes, {
      ...(await knownFor(bytes)),
      fixtureSha256: sha256(fixture),
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('LibreOffice/24.2')
    expect(evidence.producer).toBe('LibreOffice/24.2')
  })

  it('rejects a package whose app.xml names no producer', async () => {
    const { fixture, bytes } = await docxWithApplication(null)
    const evidence = await inspectWordOutput(bytes, {
      ...(await knownFor(bytes)),
      fixtureSha256: sha256(fixture),
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('producer')
  })

  it('rejects bytes that are not a DOCX at all', async () => {
    const evidence = await inspectWordOutput(encoder.encode('not a docx'), {
      fixtureSha256: 'a',
      cycle1Sha256: 'b',
      cycle1BodyText: 'c',
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('parse')
  })

  it('rejects a Word-named package whose body text is a different document', async () => {
    // A different real DOCX carrying a doctored app.xml: the producer names
    // Word yet the body is a court filing, not the round-trip document.
    const unrelated = new Uint8Array(
      readFileSync('data/evals/redact/demo-fixture.docx'),
    )
    const doc = await parseDocx(unrelated)
    doc.sourceParts.set(
      'docProps/app.xml',
      createOpaquePart(
        'docProps/app.xml',
        'xml',
        encoder.encode(appXml('Microsoft Office Word')),
      ),
    )
    const bytes = await serialiseDocx(doc)
    const evidence = await inspectWordOutput(bytes, {
      fixtureSha256: 'a',
      cycle1Sha256: 'b',
      cycle1BodyText: documentBodyText(
        await parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids')),
      ),
    })
    expect(evidence.status).toBe('rejected')
    expect(rejectedReason(evidence)).toContain('unrelated document')
    expect(evidence.producer).toBe('Microsoft Office Word')
  })

  it('reads a Word-named package as observed evidence, never a verified gate', async () => {
    const { bytes } = await docxWithApplication('Microsoft Office Word')
    const evidence = await inspectWordOutput(bytes, await knownFor(bytes))
    // A hand-edited app.xml passes the same check a real Word save does —
    // which is exactly why the status names the observation, not a verdict.
    expect(evidence.status).toBe('observed-producer-evidence')
    expect(evidence.status).not.toBe('checked')
    expect(evidence.producer).toBe('Microsoft Office Word')
    expect(evidence.appVersion).toBe('16.0000')
    expect(evidence.inputSha256).toBe(sha256(bytes))
  })

  it('records the leg as manual-reported with the gate not checked', async () => {
    const { bytes } = await docxWithApplication('Microsoft Office Word')
    const evidence = await inspectWordOutput(bytes, await knownFor(bytes))
    const record = wordRecord(evidence, 'Microsoft Word 2405 (manual)', {
      artifact: 'cycle-1-obiter-export.docx',
      sha256: 'c'.repeat(64),
    })
    // The strongest record mutable metadata can earn: a manual report that
    // stays externally unverified. No status value claims a Word run.
    expect(record).toMatchObject({
      status: 'manual-reported',
      verification: 'externally-unverified',
      claimedVersion: 'Microsoft Word 2405 (manual)',
      observedProducer: 'Microsoft Office Word',
      observedAppVersion: '16.0000',
      inputSha256: sha256(bytes),
      correlatedWith: {
        artifact: 'cycle-1-obiter-export.docx',
        sha256: 'c'.repeat(64),
      },
    })
  })

  it('records a rejection with the observed producer and the correlation', async () => {
    const { bytes } = await docxWithApplication('LibreOffice/24.2')
    const evidence = await inspectWordOutput(bytes, await knownFor(bytes))
    const record = wordRecord(evidence, 'claimed Word', {
      artifact: 'cycle-1-obiter-export.docx',
      sha256: 'd'.repeat(64),
    })
    expect(record).toMatchObject({
      status: 'rejected',
      observedProducer: 'LibreOffice/24.2',
      correlatedWith: { sha256: 'd'.repeat(64) },
    })
  })
})
