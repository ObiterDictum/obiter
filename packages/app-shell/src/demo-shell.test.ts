import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  courtOptionGroups,
  createPhaseZeroShellSnapshot,
  createLegalSearchFetchRequest,
  findMatterRecord,
  countActiveLegalSearchFilters,
  getCourtLabel,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  LEGAL_SEARCH_DEBOUNCE_MS,
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
  shouldRunLegalSearch,
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

describe('LegalSearchView helpers', () => {
  it('builds fetch requests with an optional court filter', () => {
    expect(createLegalSearchFetchRequest(' Potanina ', { court: '', dateFrom: '', dateTo: '' })).toEqual({
      query: 'Potanina',
      foregroundLiveResults: true,
    })
    expect(
      createLegalSearchFetchRequest('  tax appeal  ', {
        court: 'ukut/iac',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
      }),
    ).toEqual({
      query: 'tax appeal',
      court: 'ukut/iac',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      foregroundLiveResults: true,
    })
  })

  it('counts active search filters', () => {
    expect(countActiveLegalSearchFilters({ court: '', dateFrom: '', dateTo: '' })).toBe(0)
    expect(countActiveLegalSearchFilters({ court: 'uksc', dateFrom: '', dateTo: '' })).toBe(1)
    expect(countActiveLegalSearchFilters({ court: 'uksc', dateFrom: '2024-01-01', dateTo: '' })).toBe(2)
  })

  it('labels selected court filters for the collapsed search filter control', () => {
    expect(getCourtLabel('')).toBe('All courts and tribunals')
    expect(getCourtLabel('ewhc/admin')).toBe('Administrative Court')
    expect(getCourtLabel('unknown-court')).toBe('unknown-court')
  })

  it('exposes the current Find Case Law court filters for the search UI', () => {
    const optionCodes = courtOptionGroups.flatMap((group) =>
      group.options.map((option) => option.code),
    )

    expect(optionCodes).toEqual(
      expect.arrayContaining([
        'uksc',
        'ukpc',
        'ewca/civ',
        'ewca/crim',
        'ewhc/admin',
        'ewhc/admlty',
        'ewhc/ipec',
        'ewhc/tcc',
        'ewcr',
        'ewfc',
        'ewcop',
        'ewcc',
        'eat',
        'siac',
        'ukiptrib',
        'ukut/iac',
        'ukftt/tc',
        'ftt/transport',
      ]),
    )
    expect(optionCodes).not.toContain('ukut')
    expect(optionCodes).not.toContain('ukftt')
  })

  it('labels the component states used by the search UI', () => {
    expect(getLegalSearchStateLabel({ status: 'idle' })).toBe('idle')
    expect(getLegalSearchStateLabel({ status: 'loading', query: 'Potanina' })).toBe('loading')
    expect(getLegalSearchStateLabel({ status: 'empty', query: 'Potanina' })).toBe('empty')
    expect(
      getLegalSearchStateLabel({
        status: 'error',
        query: 'Potanina',
        message: 'Search could not reach the API.',
      }),
    ).toBe('error')
    expect(
      getLegalSearchStateLabel({
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

  it('uses a 300ms auto-search debounce window', () => {
    expect(LEGAL_SEARCH_DEBOUNCE_MS).toBe(300)
  })

  it('returns idle state while debounced input is waiting', () => {
    expect(getLegalSearchStateAfterInputChange()).toEqual({ status: 'idle' })
  })

  it('only schedules searches for non-empty queries', () => {
    expect(shouldRunLegalSearch('')).toBe(false)
    expect(shouldRunLegalSearch('   ')).toBe(false)
    expect(shouldRunLegalSearch(' Potanina ')).toBe(true)
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

  it('uses the official Find Case Law labels for new First-tier Tribunal options', () => {
    expect(getCourtLabel('ftt/pc')).toBe('First-tier Tribunal Land Registration Division (Property Chamber)')
    expect(getCourtLabel('ftt/phl')).toBe('First-tier Tribunal Primary Health Lists')
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
