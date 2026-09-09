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
  const actProvisions = [
    {
      label: 's. 9',
      labelPath: 'section/9',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      docOrder: 0,
    },
    {
      label: 's. 10',
      labelPath: 'section/10',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      docOrder: 1,
    },
    {
      label: 's. 13',
      labelPath: 'section/13',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      docOrder: 2,
    },
    {
      label: 's. 13A',
      labelPath: 'section/13A',
      extent: 'E+W+S',
      hasUnappliedEffects: false,
      docOrder: 3,
    },
    {
      label: 's. 14',
      labelPath: 'section/14',
      extent: 'E+W+S',
      hasUnappliedEffects: true,
      docOrder: 4,
    },
  ]

  function actPool(
    document: typeof actDocument | null = actDocument,
    provisions: unknown[] = actProvisions,
  ) {
    return {
      query: vi.fn(async (text: string) => {
        if (text.includes('from legislation_provisions')) {
          return { rows: provisions }
        }
        return { rows: document ? [document] : [] }
      }),
    } as unknown as LegislationServeDeps['pool']
  }

  it('serves the header and contents in document order', async () => {
    const result = await resolveLegislationActPage(actPool(), 'ukpga/2010/15')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.page.act.title).toBe('Equality Act 2010')
    expect(result.page.act.chapter).toBe('2010 c. 15')
    expect(result.page.act.officialUrl).toBe(
      'https://www.legislation.gov.uk/ukpga/2010/15',
    )
    expect(result.page.act.canonicalUrl).toBe('/ln/ukpga/2010/15')
    expect(result.page.act.contents.map((entry) => entry.label)).toEqual([
      's. 9',
      's. 10',
      's. 13',
      's. 13A',
      's. 14',
    ])
    expect(result.page.act.contents[3]?.href).toBe(
      '/ln/ukpga/2010/15/section/13A',
    )
  })

  it('counts withheld entries fail-closed without serving text', async () => {
    const flagless = {
      label: 's. 15',
      labelPath: 'section/15',
      extent: 'E+W+S',
      hasUnappliedEffects: undefined,
    }
    const result = await resolveLegislationActPage(
      actPool(actDocument, [...actProvisions, flagless]),
      'ukpga/2010/15',
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // s. 14 (flagged) plus the flagless s. 15: only explicit false reads
    // as servable, matching the provision-page gate.
    expect(result.page.act.totalCount).toBe(6)
    expect(result.page.act.withheldCount).toBe(2)
    const byLabel = new Map(
      result.page.act.contents.map((entry) => [entry.label, entry]),
    )
    expect(byLabel.get('s. 14')?.withheld).toBe(true)
    expect(byLabel.get('s. 15')?.withheld).toBe(true)
    expect(byLabel.get('s. 13')?.withheld).toBe(false)
    expect(result.page.act).not.toHaveProperty('text')
  })

  it('returns not_found for an unheld Act', async () => {
    const missing = await resolveLegislationActPage(
      actPool(null, []),
      'ukpga/2099/1',
    )
    expect(missing.status).toBe('not_found')
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
