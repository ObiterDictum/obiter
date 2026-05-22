import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createPhaseZeroShellSnapshot,
  findMatterRecord,
  getAtlasSearchStateLabel,
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
} from './index'
import {
  readCollapsedSections,
  writeCollapsedSections,
} from './sidebar/SidebarNavigation'

describe('createPhaseZeroShellSnapshot', () => {
  it('returns the Phase 0.2 authenticated shell without placeholder matters', () => {
    const snapshot = createPhaseZeroShellSnapshot('desktop')

    expect(snapshot.platform).toBe('desktop')
    expect(snapshot.matters).toHaveLength(0)
    expect(snapshot.organisation.plan).toBe('private_beta')
  })

  it('does not invent a matter when the workspace is empty', () => {
    const snapshot = createPhaseZeroShellSnapshot('web')
    const matter = findMatterRecord(snapshot, 'missing')

    expect(matter).toBeUndefined()
  })
})

describe('Home role gates', () => {
  it('keeps development status limited to Ormont owner context', async () => {
    const module = await import('./index')
    expect(module.canSeeDevelopmentStatusForTest({
      user: {
        id: 'user-amorgan',
        email: 'amorgan@ormont.local',
        name: 'A. Morgan',
        role: 'owner',
      },
      organisation: {
        id: 'org-ormont-demo',
        name: 'Ormont Legal',
        plan: 'private_beta',
      },
    })).toBe(true)

    expect(module.canSeeDevelopmentStatusForTest({
      user: {
        id: 'user-client',
        email: 'client@example.com',
        name: 'Client User',
        role: 'owner',
      },
      organisation: {
        id: 'org-client',
        name: 'Client Firm',
        plan: 'private_beta',
      },
    })).toBe(false)

    expect(module.canSeeStaffNavigationForTest({
      user: {
        id: 'user-client',
        email: 'client@example.com',
        name: 'Client User',
        role: 'owner',
      },
      organisation: {
        id: 'org-client',
        name: 'Client Firm',
        plan: 'private_beta',
      },
    })).toBe(false)
  })
})

describe('AtlasSearchView helpers', () => {
  it('labels the component states used by the search UI', () => {
    expect(getAtlasSearchStateLabel({ status: 'idle' })).toBe('idle')
    expect(getAtlasSearchStateLabel({ status: 'loading', query: 'Potanina' })).toBe('loading')
    expect(getAtlasSearchStateLabel({ status: 'empty', query: 'Potanina' })).toBe('empty')
    expect(
      getAtlasSearchStateLabel({
        status: 'error',
        query: 'Potanina',
        message: 'Search could not reach the API.',
      }),
    ).toBe('error')
    expect(
      getAtlasSearchStateLabel({
        status: 'results',
        query: 'Potanina',
        response: {
          hits: [],
          cached: false,
          indexedCount: 0,
          skippedCount: 0,
        },
      }),
    ).toBe('results')
  })

  it('selects matching paragraph excerpts for expanded search results', () => {
    const result = {
      id: 'uksc-2024-3',
      title: 'Potanina v Potanin',
      neutralCitation: '[2024] UKSC 3',
      court: 'uksc',
      dateDecided: '2024-01-31',
      sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
      paragraphs: [
        { id: 'p1', paragraphNumber: 1, text: 'Unrelated paragraph text.' },
        { id: 'p2', paragraphNumber: 2, text: 'Potanina appears in this paragraph.' },
      ],
    }
    const excerpts = selectParagraphExcerpts(
      result,
      'Potanina',
    )

    expect(excerpts).toEqual([
      { id: 'p2', paragraphNumber: 2, text: 'Potanina appears in this paragraph.' },
    ])
    expect(selectJudgmentParagraphs(result)).toHaveLength(2)
  })
})

describe('SidebarNavigation helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('persists collapsed section labels and ignores stale values', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    })

    window.localStorage.setItem(
      'ormont.sidebar.collapsedSections',
      JSON.stringify(['Evidence & Review', 'Missing section']),
    )

    expect([...readCollapsedSections()]).toEqual(['Evidence & Review'])

    writeCollapsedSections(new Set(['Operations']))

    expect(window.localStorage.getItem('ormont.sidebar.collapsedSections')).toBe(
      JSON.stringify(['Operations']),
    )
  })
})
