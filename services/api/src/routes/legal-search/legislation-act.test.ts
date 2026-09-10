import { describe, expect, it, vi } from 'vitest'
import { resolveLegislationActPage } from './legislation-act'
import type { LegislationServeDeps } from './legislation-serve'

describe('resolveLegislationActPage', () => {
  const actDocument = {
    identity: 'ukpga/2010/15',
    actType: 'ukpga',
    year: 2010,
    number: 15,
    title: 'Equality Act 2010',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    extent: 'E+W+S',
  }

  // Document order: s. 10 follows s. 9, and the inserted s. 13A sits
  // between ss. 13 and 14. Lexical label sort would put s. 10 first.
  const actProvisions: Array<{
    label: string
    labelPath: string
    extent: string
    hasUnappliedEffects: boolean
    effectsCheckedAt: string | null
    docOrder: number
    kind: string
    parentLabelPath: string | null
  }> = [
    {
      label: 'Part 2',
      labelPath: 'part/2',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 0,
      kind: 'part',
      parentLabelPath: null,
    },
    {
      label: 's. 9',
      labelPath: 'section/9',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 1,
      kind: 'P1',
      parentLabelPath: 'part/2',
    },
    {
      label: 's. 10',
      labelPath: 'section/10',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 2,
      kind: 'P1',
      parentLabelPath: 'part/2',
    },
    {
      label: 's. 13',
      labelPath: 'section/13',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 3,
      kind: 'P1',
      parentLabelPath: 'part/2',
    },
    {
      label: 's. 13A',
      labelPath: 'section/13A',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 4,
      kind: 'P1',
      parentLabelPath: 'part/2',
    },
    {
      label: 's. 14',
      labelPath: 'section/14',
      extent: 'E+W+S',
      hasUnappliedEffects: true,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 5,
      kind: 'P1',
      parentLabelPath: 'part/2',
    },
    {
      label: 'Schedule 2',
      labelPath: 'schedule/2',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 6,
      kind: 'schedule',
      parentLabelPath: null,
    },
    {
      label: 'Sch. 2 para. 4',
      labelPath: 'schedule/2/paragraph/4',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 7,
      kind: 'P1',
      parentLabelPath: 'schedule/2',
    },
    {
      label: 'Sch. 2 para. 5',
      labelPath: 'schedule/2/paragraph/5',
      extent: 'E+W+S',
      hasUnappliedEffects: true,
      effectsCheckedAt: '2026-09-01T00:00:00Z',
      docOrder: 8,
      kind: 'P1',
      parentLabelPath: 'schedule/2',
    },
  ]

  function actPool(
    document: typeof actDocument | null = actDocument,
    provisions: unknown[] = actProvisions,
    classified = true,
  ) {
    return {
      query: vi.fn(async (text: string) => {
        // The Act-page gate flag and the content rows are returned by one
        // statement (getLegislationActProvisionsSnapshot), so the fixture
        // answers both from that single snapshot shape.
        if (text.includes('json_agg')) {
          return { rows: [{ classified, rows: provisions }] }
        }
        return { rows: document ? [document] : [] }
      }),
    } as unknown as LegislationServeDeps['pool']
  }

  it('serves the header and a hierarchy in document order', async () => {
    const result = await resolveLegislationActPage(actPool(), 'ukpga/2010/15')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.act.title).toBe('Equality Act 2010')
    expect(result.page.act.chapter).toBe('2010 c. 15')
    expect(result.page.act.officialUrl).toBe(
      'https://www.legislation.gov.uk/ukpga/2010/15',
    )
    expect(result.page.act.canonicalUrl).toBe('/ln/ukpga/2010/15')
    // Roots are the containers; the inserted s. 13A stays between ss. 13
    // and 14 inside Part 2, and the schedule has its paragraphs inside.
    expect(result.page.act.contents.map((entry) => entry.label)).toEqual([
      'Part 2',
      'Schedule 2',
    ])
    const part2 = result.page.act.contents[0]!
    expect(part2.kind).toBe('part')
    expect(part2.children.map((entry) => entry.label)).toEqual([
      's. 9',
      's. 10',
      's. 13',
      's. 13A',
      's. 14',
    ])
    expect(part2.children[3]?.href).toBe('/ln/ukpga/2010/15/section/13A')
    const schedule2 = result.page.act.contents[1]!
    expect(schedule2.kind).toBe('schedule')
    expect(schedule2.children.map((entry) => entry.label)).toEqual([
      'Sch. 2 para. 4',
      'Sch. 2 para. 5',
    ])
  })

  it('counts withheld content rows only, containers excluded', async () => {
    // withheld: s. 14 and Sch. 2 para. 5. Containers (Part 2, Schedule 2)
    // are headings and never figure in either count.
    const result = await resolveLegislationActPage(actPool(), 'ukpga/2010/15')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.act.totalCount).toBe(7)
    expect(result.page.act.withheldCount).toBe(2)
  })

  it('counts flagless rows fail-closed as withheld', async () => {
    const flagless = {
      label: 's. 15',
      labelPath: 'section/15',
      extent: 'E+W+S',
      hasUnappliedEffects: undefined,
      effectsCheckedAt: undefined,
      docOrder: 9,
      kind: 'P1',
      parentLabelPath: null,
    }
    const result = await resolveLegislationActPage(
      actPool(actDocument, [...actProvisions, flagless]),
      'ukpga/2010/15',
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // s. 14, Sch. 2 para. 5 (flagged) plus the flagless s. 15: only
    // explicit false reads as servable, matching the provision-page gate.
    expect(result.page.act.totalCount).toBe(8)
    expect(result.page.act.withheldCount).toBe(3)
    expect(result.page.act.contents).toHaveLength(3)
    expect(result.page.act).not.toHaveProperty('text')
  })

  it('counts unchecked false rows as withheld, not servable', async () => {
    // A legacy row with flag false but no check timestamp (migration
    // default) is unknown, not known-good: it must withhold like a flagged
    // row even though has_unapplied_effects reads false.
    const unchecked = {
      label: 's. 16',
      labelPath: 'section/16',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      effectsCheckedAt: null,
      docOrder: 9,
      kind: 'P1',
      parentLabelPath: null,
    }
    const result = await resolveLegislationActPage(
      actPool(actDocument, [...actProvisions, unchecked]),
      'ukpga/2010/15',
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.act.totalCount).toBe(8)
    expect(result.page.act.withheldCount).toBe(3)
    const s16 = result.page.act.contents.find(
      (entry) => entry.labelPath === 'section/16',
    )
    expect(s16?.withheld).toBe(true)
  })

  it('returns not_found for an unheld Act', async () => {
    const missing = await resolveLegislationActPage(
      actPool(null, []),
      'ukpga/2010/15',
    )
    expect(missing).toEqual({ status: 'not_found' })
  })

  it('withholds the whole page while legacy rows are unclassified', async () => {
    // Pre-migration rows carry kind = NULL (migration 0022 leaves them
    // unknown rather than defaulting to a misleading 'P1'), so without the
    // gate their P2..P5 content would render as flat top-level provisions.
    const legacy = actPool(actDocument, [], /* classified */ false)
    const result = await resolveLegislationActPage(legacy, 'ukpga/2010/15')
    expect(result.status).toBe('unavailable')
    expect(legacy.query).toHaveBeenCalled()
  })

  it('never serves an incomplete tree from a torn reparse read', async () => {
    // Regression for the gate/contents race: gate and rows must be read by
    // one statement so they share one snapshot. The fake pool simulates the
    // interleaving that broke the old two-query read — the listing
    // statement's snapshot predates the --force-reparse commit (legacy
    // NULL-kind rows filtered out, no rows), while an independent gate
    // statement reads after it (classified true). A combined statement can
    // never see that mix: it returns the pre-commit snapshot (gate closed),
    // so the page withholds instead of serving an empty 200 tree.
    const torn = {
      query: vi.fn(async (text: string) => {
        if (text.includes('json_agg')) {
          // Single statement: pre-commit snapshot, legacy NULL kinds still
          // present, so the gate reads unclassified and the listing is
          // empty. This is the consistent answer an indivisible read gives.
          return { rows: [{ classified: false, rows: [] }] }
        }
        if (text.includes('kind is null')) {
          // Tear: a gate-only statement reading after the commit.
          return { rows: [{ classified: true }] }
        }
        if (text.includes('from legislation_provisions')) {
          // Tear: a listing-only statement reading before the commit.
          return { rows: [] }
        }
        return { rows: [actDocument] }
      }),
    } as unknown as LegislationServeDeps['pool']
    const result = await resolveLegislationActPage(torn, 'ukpga/2010/15')
    expect(result.status).toBe('unavailable')
    // Gate and contents travel in one statement: the document read plus one
    // snapshot read, never a third independent gate query.
    expect(torn.query).toHaveBeenCalledTimes(2)
  })

  it('returns unavailable when the store is down', async () => {
    const down = {
      query: vi.fn(async () => {
        throw new Error('db down')
      }),
    } as unknown as LegislationServeDeps['pool']
    const result = await resolveLegislationActPage(down, 'ukpga/2010/15')
    expect(result.status).toBe('unavailable')
  })
})
