import { Pool } from 'pg'
import { createTestPool } from './test-database.test-support'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { VerificationSubject } from '@obiter/verification-core'
import { resolveCitationCandidates } from './citation-resolution'
import { createResolutionPipeline } from './citation-resolution.test-support'

/**
 * Legislation citation resolution against the real Postgres record, run through
 * the authority-existence check. The point of most of these is the boundary:
 * resolution establishes the identity, and only V2 answers whether Obiter holds
 * it. Requires TEST_DATABASE_URL.
 */

const subject: VerificationSubject = { documentId: 'd-v3-db', versionId: 'v-1' }

interface ProvisionFixture {
  labelPath: string
  label: string
  kind?: string
}

interface ActFixture {
  identity: string
  year: number
  number: number
  title: string
  provisions: ProvisionFixture[]
}

const actFixtures: ActFixture[] = [
  {
    identity: 'ukpga/2066/1',
    year: 2066,
    number: 1,
    title: 'Test Authority Act 2066',
    provisions: [
      { labelPath: 'section/1', label: 's. 1' },
      { labelPath: 'section/40', label: 's. 40' },
      { labelPath: 'section/40/2', label: 's. 40(2)' },
    ],
  },
  {
    identity: 'ukpga/2066/2',
    year: 2066,
    number: 2,
    title: 'Empty Test Act 2066',
    provisions: [],
  },
  {
    identity: 'ukpga/2066/4',
    year: 2066,
    number: 4,
    title: 'Single Schedule Test Act 2066',
    provisions: [{ labelPath: 'schedule/paragraph/4', label: 'Sch. para. 4' }],
  },
  {
    identity: 'ukpga/2066/5',
    year: 2066,
    number: 5,
    title: 'Numbered Schedules Test Act 2066',
    provisions: [
      { labelPath: 'schedule/1/paragraph/1', label: 'Sch. 1 para. 1' },
      { labelPath: 'schedule/2/paragraph/1', label: 'Sch. 2 para. 1' },
    ],
  },
  {
    identity: 'ukpga/2066/6',
    year: 2066,
    number: 6,
    title: 'Duplicate Title Act 2066',
    provisions: [],
  },
  {
    identity: 'ukpga/2066/7',
    year: 2066,
    number: 7,
    title: 'Duplicate Title Act 2066',
    provisions: [],
  },
  {
    identity: 'ukpga/2066/8',
    year: 2066,
    number: 8,
    title: 'Repealed Test Act 2066 (repealed)',
    provisions: [],
  },
  {
    identity: 'ukpga/2066/9',
    year: 2066,
    number: 9,
    title: 'Children\u2019s Rights Test Act 2066',
    provisions: [],
  },
  {
    // The curated `HRA 1998` alias resolves by stored title, so this fixture
    // keeps that title and takes a synthetic chapter. Using the real chapter
    // identity put a delete on a real Act in this suite's cleanup, which only
    // stayed harmless while the test database happened to be empty.
    identity: 'ukpga/2066/10',
    year: 2066,
    number: 10,
    title: 'Human Rights Act 1998',
    provisions: [],
  },
]

const singleScheduleAct = 'ukpga/2066/4'
const numberedSchedulesAct = 'ukpga/2066/5'

describe('legislation resolution against the stored record', () => {
  const pool = createTestPool()
  const { resolveOne, resolveThenCheck } = createResolutionPipeline(
    pool,
    subject,
  )

  beforeAll(async () => {
    for (const act of actFixtures) {
      await pool.query(
        `insert into legislation_documents
           (identity, act_type, year, number, title, source_url, content_hash)
         values ($1, 'ukpga', $2, $3, $4, $5, $6)`,
        [
          act.identity,
          act.year,
          act.number,
          act.title,
          `https://www.legislation.gov.uk/${act.identity}`,
          `dbtest-v3-${act.identity}`,
        ],
      )
      for (const [index, provision] of act.provisions.entries()) {
        await pool.query(
          `insert into legislation_provisions
             (id, document_identity, label_path, label, provision_text,
              source_hash, doc_order, has_unapplied_effects, effects_checked_at,
              kind)
           values ($1, $2, $3, $4, $5, $6, $7, false, now(), $8)`,
          [
            `${act.identity}/${provision.labelPath}`,
            act.identity,
            provision.labelPath,
            provision.label,
            `Text of ${provision.label}.`,
            `dbtest-v3-${act.identity}-${index}`,
            index,
            provision.kind ?? 'P1',
          ],
        )
      }
    }
  })

  afterAll(async () => {
    await pool.query(
      `delete from legislation_provisions where document_identity like 'ukpga/2066/%'`,
    )
    await pool.query(
      `delete from legislation_documents where identity like 'ukpga/2066/%'`,
    )
    await pool.end()
  })

  it('resolves a canonical short title and clears the whole Act', async () => {
    const { resolution, finding } = await resolveThenCheck(
      'Test Authority Act 2066',
    )

    expect(resolution).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: null,
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_document',
        granularity: 'document',
        sourceId: 'ukpga/2066/1',
      },
    ])
  })

  it('resolves a held chapter citation to the same identity', async () => {
    expect(await resolveOne('2066 c. 1')).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: null,
      },
    })
  })

  it('resolves an unheld chapter and reports it not held, never fictitious', async () => {
    const { resolution, finding } = await resolveThenCheck('2066 c. 99')

    expect(resolution).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/99',
        labelPath: null,
      },
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
    expect(finding.explanation.toLowerCase()).not.toContain('does not exist')
  })

  it('resolves the curated alias against the stored title directory', async () => {
    expect(await resolveOne('HRA 1998')).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/10',
        labelPath: null,
      },
    })
  })

  it('resolves a stored (repealed) title with and without the annotation', async () => {
    for (const rawText of [
      'Repealed Test Act 2066',
      'Repealed Test Act 2066 (repealed)',
    ]) {
      expect(await resolveOne(rawText)).toEqual({
        outcome: 'resolved',
        citation: {
          kind: 'legislation',
          documentIdentity: 'ukpga/2066/8',
          labelPath: null,
        },
      })
    }
  })

  it('folds the straight and curly apostrophe to the same stored Act', async () => {
    for (const rawText of [
      "Children's Rights Test Act 2066",
      'Children\u2019s Rights Test Act 2066',
    ]) {
      expect(await resolveOne(rawText)).toEqual({
        outcome: 'resolved',
        citation: {
          kind: 'legislation',
          documentIdentity: 'ukpga/2066/9',
          labelPath: null,
        },
      })
    }
  })

  it('resolves a held provision and clears it on the provision fragment', async () => {
    const { resolution, finding } = await resolveThenCheck(
      's 40 Test Authority Act 2066',
    )

    expect(resolution).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: 'section/40',
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: 'ukpga/2066/1',
        labelPath: 'section/40',
      },
    ])
  })

  it.each([
    's 40 Test Authority Act 2066',
    'Test Authority Act 2066 s 40',
    'section 40 Test Authority Act 2066',
  ])('keeps the section path for %j', async (rawText) => {
    expect(await resolveOne(rawText)).toMatchObject({
      outcome: 'resolved',
      citation: { labelPath: 'section/40' },
    })
  })

  it('keeps the nested group path a provision citation names', async () => {
    const { resolution, finding } = await resolveThenCheck(
      's 40(2) Test Authority Act 2066',
    )

    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: { labelPath: 'section/40/2' },
    })
    expect(finding.status).toEqual({ state: 'clear' })
  })

  it('resolves a missing provision of a held Act, which is V2s question', async () => {
    const { resolution, finding } = await resolveThenCheck(
      's 99 Test Authority Act 2066',
    )

    // Resolution established the identity; whether the provision is held is the
    // existence check's answer, and it is not a resolution failure.
    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: { labelPath: 'section/99' },
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'authority_not_held',
    })
  })

  it('resolves a numbered schedule citation and clears it', async () => {
    const { resolution, finding } = await resolveThenCheck(
      'Schedule 2 paragraph 1 Numbered Schedules Test Act 2066',
    )

    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: {
        documentIdentity: numberedSchedulesAct,
        labelPath: 'schedule/2/paragraph/1',
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
  })

  it('resolves the single-schedule citation and lets V2 apply the alias', async () => {
    const { resolution, finding } = await resolveThenCheck(
      'Schedule 1 paragraph 4 Single Schedule Test Act 2066',
    )

    // Resolution keeps the path the citation names; the single-schedule alias
    // has one owner and it is the store resolver V2 calls, so resolution does
    // not duplicate it.
    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: {
        documentIdentity: singleScheduleAct,
        labelPath: 'schedule/1/paragraph/4',
      },
    })
    expect(finding.status).toEqual({ state: 'clear' })
    expect(finding.evidence).toEqual([
      {
        sourceType: 'legislation_provision',
        granularity: 'fragment',
        sourceId: singleScheduleAct,
        labelPath: 'schedule/paragraph/4',
      },
    ])
  })

  it('resolves an underspecified schedule and lets V2 report it inconclusive', async () => {
    const { resolution, finding } = await resolveThenCheck(
      'Schedule paragraph 1 Numbered Schedules Test Act 2066',
    )

    expect(resolution).toMatchObject({
      outcome: 'resolved',
      citation: { labelPath: 'schedule/paragraph/1' },
    })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'check_inconclusive',
    })
  })

  it('leaves an ambiguous folded title ambiguous, never a guessed Act', async () => {
    const { resolution, finding } = await resolveThenCheck(
      'Duplicate Title Act 2066',
    )

    expect(resolution).toEqual({ outcome: 'ambiguous' })
    expect(finding.status).toEqual({
      state: 'review_required',
      reason: 'citation_ambiguous',
    })
  })

  it('leaves a title the stored directory cannot resolve unresolved', async () => {
    expect(await resolveOne('Some Unstored Act 2066')).toEqual({
      outcome: 'unresolved',
    })
  })

  it.each([
    'defences under the Test Authority Act 2066',
    'Test Authority Act 2066 as applied',
    'The powers in Test Authority Act 2066 were amended',
  ])('refuses to resolve the prose candidate %j', async (rawText) => {
    expect(await resolveOne(rawText)).toEqual({ outcome: 'malformed' })
  })

  it('resolves a canonical /ln/ path with no store read at all', async () => {
    let queries = 0
    const counting = {
      query: (text: string, values?: unknown[]) => {
        queries += 1
        return pool.query(text, values as never)
      },
    } as unknown as Pick<Pool, 'query'>

    const [result] = await resolveCitationCandidates(counting, [
      { id: 'path', rawText: '/ln/ukpga/2066/1/section/40' },
    ])

    expect(queries).toBe(0)
    expect(result?.resolution).toEqual({
      outcome: 'resolved',
      citation: {
        kind: 'legislation',
        documentIdentity: 'ukpga/2066/1',
        labelPath: 'section/40',
      },
    })
  })

  it('reports every candidate inconclusive when the store cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = {
      query: async () => {
        throw new Error('connection terminated unexpectedly')
      },
    } as unknown as Pick<Pool, 'query'>

    const results = await resolveCitationCandidates(broken, [
      { id: 'case-law', rawText: '[2066] UKSC 1' },
      { id: 'title', rawText: 'Test Authority Act 2066' },
      { id: 'path', rawText: '/ln/ukpga/2066/1' },
    ])

    expect(results.map((result) => result.resolution)).toEqual([
      { outcome: 'inconclusive', reason: 'store_error' },
      { outcome: 'inconclusive', reason: 'store_error' },
      {
        outcome: 'resolved',
        citation: {
          kind: 'legislation',
          documentIdentity: 'ukpga/2066/1',
          labelPath: null,
        },
      },
    ])
    expect(JSON.stringify(warn.mock.calls)).not.toContain('[2066]')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Test Authority')
    warn.mockRestore()
  })
})
