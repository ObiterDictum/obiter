import { describe, expect, it } from 'vitest'
import {
  courtOptionGroups,
  createPhaseZeroShellSnapshot,
  createLegalSearchFetchRequest,
  findMatterRecord,
  countActiveLegalSearchFilters,
  getCourtLabel,
  getLegalSearchEmptyFeedback,
  getRecentLegalSearches,
  getLegalSearchStateAfterInputChange,
  getLegalSearchStateLabel,
  LEGAL_SEARCH_DEBOUNCE_MS,
  LEGAL_SEARCH_RECENT_SEARCHES_LIMIT,
  selectJudgmentParagraphs,
  selectParagraphExcerpts,
  shouldRunLegalSearch,
  shouldRunLegalSearchRequest,
  writeRecentLegalSearch,
} from './index'

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
  it('keeps development status limited to Obiter owner context', async () => {
    const module = await import('./index')
    expect(module.canSeeDevelopmentStatusForTest({
      user: {
        id: 'user-amorgan',
        email: 'amorgan@obiter.local',
        name: 'A. Morgan',
        role: 'owner',
      },
      organisation: {
        id: 'org-obiter-demo',
        name: 'Obiter Legal',
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
    expect(
      createLegalSearchFetchRequest('  section 6  ', {
        court: '',
        dateFrom: '',
        dateTo: '',
        sourceType: 'legislation_provision',
        sourceFamily: 'legislation',
        legalDomain: 'human-rights',
        provider: 'legislation-gov-uk',
        topic: 'Human Rights Act',
        asAtDate: '2024-01-01',
        legislationVersion: 'current',
      }),
    ).toEqual({
      query: 'section 6',
      sourceType: 'legislation_provision',
      sourceFamily: 'legislation',
      legalDomain: 'human-rights',
      provider: 'legislation-gov-uk',
      topic: 'Human Rights Act',
      asAtDate: '2024-01-01',
      legislationVersion: 'current',
      foregroundLiveResults: true,
    })
  })

  it('counts active search filters', () => {
    expect(countActiveLegalSearchFilters({ court: '', dateFrom: '', dateTo: '' })).toBe(0)
    expect(countActiveLegalSearchFilters({ court: 'uksc', dateFrom: '', dateTo: '' })).toBe(1)
    expect(countActiveLegalSearchFilters({ court: 'uksc', dateFrom: '2024-01-01', dateTo: '' })).toBe(2)
    expect(
      countActiveLegalSearchFilters({
        court: '',
        dateFrom: '',
        dateTo: '',
        sourceType: 'legislation_document',
        asAtDate: '2024-01-01',
      }),
    ).toBe(2)
  })

  it('labels selected court filters for the collapsed search filter control', () => {
    expect(getCourtLabel('')).toBe('All courts and tribunals')
    expect(getCourtLabel('ewhc')).toBe('High Court')
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

  it('labels explicit empty search outcomes', () => {
    expect(getLegalSearchEmptyFeedback({ query: 'Potanina', outcome: 'no_match' })).toEqual({
      eyebrow: 'No indexed match',
      title: 'No sources found',
      body: 'Stored legal sources and available provider results did not match "Potanina" with the selected filters.',
    })
    expect(getLegalSearchEmptyFeedback({ query: 'Potanina', outcome: 'hydration_queued' })).toMatchObject({
      eyebrow: 'Search queued',
      title: 'Checking legal sources',
    })
    expect(
      getLegalSearchEmptyFeedback({
        query: '',
        outcome: 'stored_browse_empty',
        browse: { courtLabel: 'UK Supreme Court' },
      }),
    ).toEqual({
      eyebrow: 'No stored cases',
      title: 'No recent cases found',
      body: 'No recent stored cases found for UK Supreme Court.',
    })
  })

  it('only schedules searches for non-empty queries', () => {
    expect(shouldRunLegalSearch('')).toBe(false)
    expect(shouldRunLegalSearch('   ')).toBe(false)
    expect(shouldRunLegalSearch(' Potanina ')).toBe(true)
    expect(shouldRunLegalSearchRequest('', { court: 'uksc', dateFrom: '', dateTo: '' })).toBe(true)
  })

  it('deduplicates recent searches and keeps a small session list', () => {
    const storage = new Map<string, string>()
    const sessionStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }

    writeRecentLegalSearch(sessionStorage, ' Potanina ')
    writeRecentLegalSearch(sessionStorage, 'beneficial ownership')
    writeRecentLegalSearch(sessionStorage, 'POTANINA')
    writeRecentLegalSearch(sessionStorage, '[2024] UKSC 3')
    writeRecentLegalSearch(sessionStorage, 'public law')
    writeRecentLegalSearch(sessionStorage, 'tax appeal')
    writeRecentLegalSearch(sessionStorage, 'late evidence')

    expect(getRecentLegalSearches(sessionStorage)).toEqual([
      'late evidence',
      'tax appeal',
      'public law',
      '[2024] UKSC 3',
      'POTANINA',
    ])
    expect(getRecentLegalSearches(sessionStorage)).toHaveLength(LEGAL_SEARCH_RECENT_SEARCHES_LIMIT)
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
        {
          id: 'p1',
          paragraphNumber: 1,
          text: 'The application arises from financial remedy proceedings after an overseas divorce.',
        },
        {
          id: 'p2',
          paragraphNumber: 2,
          text: 'Potanina appears in the judgment when the court considers permission under Part III.',
        },
      ],
    }
    const excerpts = selectParagraphExcerpts(
      result,
      'Potanina',
    )

    expect(excerpts).toEqual([
      {
        id: 'p2',
        paragraphNumber: 2,
        text: 'Potanina appears in the judgment when the court considers permission under Part III.',
      },
    ])
    expect(selectJudgmentParagraphs(result)).toHaveLength(2)
  })

  it('uses the official Find Case Law labels for new First-tier Tribunal options', () => {
    expect(getCourtLabel('ftt/pc')).toBe('First-tier Tribunal Land Registration Division (Property Chamber)')
    expect(getCourtLabel('ftt/phl')).toBe('First-tier Tribunal Primary Health Lists')
  })
})
