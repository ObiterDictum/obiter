import { Pool } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveLegislationActPage } from '../legislation-act'

/**
 * Act-page transitional gate against the real Postgres record store:
 * rows written before migration 0022 carry kind = NULL (the migration
 * deliberately leaves them unknown rather than defaulting to 'P1', which
 * would mis-classify P2..P5 content as flat top-level provisions), and
 * until --force-reparse rewrites every row of the document the Act page
 * must read as unavailable, never as a mis-classified tree. After the
 * rewrite (simulated with the same row updates the ingestor performs) the
 * page serves with containers and P1 rows only, P2..P5 staying off the
 * page. Requires TEST_DATABASE_URL.
 */

const identity = 'ukpga/2024/99'
const title = 'Migration Gate Test Act 2024'

const legacyRows = [
  {
    id: `${identity}/part/1`,
    labelPath: 'part/1',
    label: 'Part 1',
    extent: 'E+W+S',
    text: 'Part 1 test heading',
    docOrder: 0,
  },
  {
    id: `${identity}/section/1`,
    labelPath: 'section/1',
    label: 's. 1',
    extent: 'E+W+S',
    text: 'Section 1 test body.',
    docOrder: 1,
  },
  {
    id: `${identity}/section/1/2`,
    labelPath: 'section/1/2',
    label: 's. 1(2)',
    extent: 'E+W+S',
    text: 'Subsection 2 test body.',
    docOrder: 2,
  },
  {
    id: `${identity}/section/2`,
    labelPath: 'section/2',
    label: 's. 2',
    extent: 'E+W+S',
    text: 'Section 2 test body.',
    docOrder: 3,
  },
]

function insertProvisionRowQuery(
  row: (typeof legacyRows)[number],
  kind: string | null,
  parentLabelPath: string | null,
) {
  return {
    text: `insert into legislation_provisions
      (id, document_identity, label_path, label, parent_label_path, kind,
       extent, provision_text, source_hash, doc_order,
       has_unapplied_effects, effects_checked_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
     on conflict (id) do update set
       parent_label_path = excluded.parent_label_path,
       kind = excluded.kind,
       effects_checked_at = excluded.effects_checked_at,
       updated_at = now()`,
    values: [
      row.id,
      identity,
      row.labelPath,
      row.label,
      parentLabelPath,
      kind,
      row.extent,
      row.text,
      'migration-gate-test-hash',
      row.docOrder,
      false,
      null,
    ],
  }
}

describe('legislation act-page transition gate', () => {
  const connectionString = process.env.TEST_DATABASE_URL
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is required for legislation-migration-gate.db.test.ts',
    )
  }
  const pool = new Pool({ connectionString })

  beforeAll(async () => {
    await pool.query(
      `insert into legislation_documents
      (identity, act_type, year, number, title, source_url, content_hash,
       provision_count_note, updated_at)
     values ($1, 'ukpga', 2024, 99, $2, $3, 'migration-gate-test-hash', '', now())`,
      [identity, title, `https://www.legislation.gov.uk/${identity}`],
    )
    for (const row of legacyRows) {
      await pool.query(insertProvisionRowQuery(row, null, null))
    }
  })

  afterAll(async () => {
    await pool.query(
      'delete from legislation_provisions where document_identity = $1',
      [identity],
    )
    await pool.query('delete from legislation_documents where identity = $1', [
      identity,
    ])
    await pool.end()
  })

  it('returns unavailable while legacy rows carry no kind', async () => {
    const result = await resolveLegislationActPage(pool, identity)
    expect(result).toEqual({ status: 'unavailable' })
  })

  it('serves the tree only after the reparse rewrite classifies every row', async () => {
    // The reparse ingestor rewrites every row of the document in one
    // transaction; simulate the same result: container rows get container
    // kinds, P1 rows 'P1', sub-provisions their true P2..P5 kinds.
    const reparsed = [
      { row: legacyRows[0]!, kind: 'part', parent: null },
      { row: legacyRows[1]!, kind: 'P1', parent: 'part/1' },
      { row: legacyRows[2]!, kind: 'P2', parent: 'section/1' },
      { row: legacyRows[3]!, kind: 'P1', parent: 'part/1' },
    ]
    for (const { row, kind, parent } of reparsed) {
      await pool.query(insertProvisionRowQuery(row, kind, parent))
    }

    const result = await resolveLegislationActPage(pool, identity)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // P2 sub-provisions never render on the Act page: only the container
    // roots with their P1 children.
    expect(result.page.act.contents.map((entry) => entry.label)).toEqual([
      'Part 1',
    ])
    const part1 = result.page.act.contents[0]!
    expect(part1.kind).toBe('part')
    expect(part1.children.map((entry) => entry.label)).toEqual(['s. 1', 's. 2'])
    expect(result.page.act.totalCount).toBe(2)
  })
})
