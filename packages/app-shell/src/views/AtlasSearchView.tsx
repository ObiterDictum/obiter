import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, EmptyState } from '@ormont/ui'

interface AtlasParagraph {
  id: string
  paragraphNumber: number
  text: string
}

interface AtlasSearchResult {
  id: string
  title: string
  neutralCitation: string
  court: string
  dateDecided: string
  sourceUrl: string
  paragraphs?: AtlasParagraph[]
}

interface AtlasFetchResponse {
  hits: AtlasSearchResult[]
  cached: boolean
  indexedCount: number
  skippedCount: number
}

interface AtlasFetchRequestFilters {
  court: string
  dateFrom: string
  dateTo: string
}

interface AtlasCourtOption {
  code: string
  label: string
}

interface AtlasCourtOptionGroup {
  label: string
  options: AtlasCourtOption[]
}

export const atlasCourtOptionGroups: AtlasCourtOptionGroup[] = [
  {
    label: 'Supreme courts',
    options: [
      { code: 'uksc', label: 'UK Supreme Court' },
      { code: 'ukpc', label: 'Privy Council' },
    ],
  },
  {
    label: 'Court of Appeal',
    options: [
      { code: 'ewca/civ', label: 'Court of Appeal Civil Division' },
      { code: 'ewca/crim', label: 'Court of Appeal Criminal Division' },
    ],
  },
  {
    label: 'High Court',
    options: [
      { code: 'ewhc/admin', label: 'Administrative Court' },
      { code: 'ewhc/admlty', label: 'Admiralty Court' },
      { code: 'ewhc/ch', label: 'Chancery Division' },
      { code: 'ewhc/comm', label: 'Commercial Court' },
      { code: 'ewhc/fam', label: 'Family Division' },
      { code: 'ewhc/ipec', label: 'Intellectual Property Enterprise Court' },
      { code: 'ewhc/kb', label: "King's Bench Division" },
      { code: 'ewhc/mercantile', label: 'Mercantile Court' },
      { code: 'ewhc/pat', label: 'Patents Court' },
      { code: 'ewhc/scco', label: 'Senior Courts Costs Office' },
      { code: 'ewhc/tcc', label: 'Technology and Construction Court' },
    ],
  },
  {
    label: 'England and Wales courts',
    options: [
      { code: 'ewcr', label: 'Crown Court' },
      { code: 'ewcc', label: 'County Court' },
      { code: 'ewfc', label: 'Family Court' },
      { code: 'ewcop', label: 'Court of Protection' },
    ],
  },
  {
    label: 'Tribunals and commissions',
    options: [
      { code: 'eat', label: 'Employment Appeal Tribunal' },
      { code: 'ukiptrib', label: 'Investigatory Powers Tribunal' },
      { code: 'siac', label: 'Special Immigration Appeals Commission' },
      { code: 'ukist', label: 'Immigration Services Tribunal' },
      { code: 'ukut/aac', label: 'Upper Tribunal Administrative Appeals Chamber' },
      { code: 'ukut/iac', label: 'Upper Tribunal Immigration and Asylum Chamber' },
      { code: 'ukut/lc', label: 'Upper Tribunal Lands Chamber' },
      { code: 'ukut/tcc', label: 'Upper Tribunal Tax and Chancery Chamber' },
      { code: 'ukftt/credit', label: 'First-tier Tribunal Consumer Credit' },
      { code: 'ukftt/estate', label: 'First-tier Tribunal Estate Agents' },
      { code: 'ukftt/grc', label: 'First-tier Tribunal General Regulatory Chamber' },
      { code: 'ukftt/hesc', label: 'First-tier Tribunal Health, Education and Social Care' },
      { code: 'ukftt/tc', label: 'First-tier Tribunal Tax Chamber' },
      { code: 'ftt/claims', label: 'First-tier Tribunal Claims Management' },
      { code: 'ftt/pc', label: 'First-tier Tribunal Primary Care' },
      { code: 'ftt/phl', label: 'First-tier Tribunal Public Health List' },
      { code: 'ftt/transport', label: 'First-tier Tribunal Transport' },
    ],
  },
]

type AtlasSearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'results'; query: string; response: AtlasFetchResponse }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; message: string }

export function getAtlasSearchStateLabel(state: AtlasSearchState) {
  switch (state.status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'loading'
    case 'results':
      return 'results'
    case 'empty':
      return 'empty'
    case 'error':
      return 'error'
  }
}

export function selectParagraphExcerpts(
  result: AtlasSearchResult,
  query: string,
): AtlasParagraph[] {
  const normalizedQuery = query.trim().toLowerCase()
  const paragraphs = result.paragraphs ?? []

  if (!normalizedQuery) {
    return paragraphs.slice(0, 3)
  }

  const matches = paragraphs.filter((paragraph) =>
    paragraph.text.toLowerCase().includes(normalizedQuery),
  )

  return (matches.length > 0 ? matches : paragraphs).slice(0, 3)
}

export function selectJudgmentParagraphs(result: AtlasSearchResult): AtlasParagraph[] {
  return result.paragraphs ?? []
}

export function createAtlasFetchRequest(query: string, filters: AtlasFetchRequestFilters) {
  const trimmedQuery = query.trim()
  const request: { query: string; court?: string; dateFrom?: string; dateTo?: string } = {
    query: trimmedQuery,
  }
  const court = filters.court.trim()
  const dateFrom = filters.dateFrom.trim()
  const dateTo = filters.dateTo.trim()

  if (court) request.court = court
  if (dateFrom) request.dateFrom = dateFrom
  if (dateTo) request.dateTo = dateTo

  return request
}

export function getAtlasCourtLabel(code: string) {
  if (!code) return 'All courts and tribunals'

  for (const group of atlasCourtOptionGroups) {
    const option = group.options.find((courtOption) => courtOption.code === code)
    if (option) return option.label
  }

  return code
}

export function countAtlasActiveFilters(filters: AtlasFetchRequestFilters) {
  return [filters.court, filters.dateFrom, filters.dateTo].filter((value) => value.trim()).length
}

export function AtlasSearchView() {
  const [query, setQuery] = useState(() => readInitialSearchQuery())
  const [court, setCourt] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [draftCourt, setDraftCourt] = useState('')
  const [draftDateFrom, setDraftDateFrom] = useState('')
  const [draftDateTo, setDraftDateTo] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [state, setState] = useState<AtlasSearchState>({ status: 'idle' })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedQuery = query.trim()
    if (!trimmedQuery) return

    setState({ status: 'loading', query: trimmedQuery })

    try {
      const response = await fetch('/api/search/fetch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(createAtlasFetchRequest(trimmedQuery, { court, dateFrom, dateTo })),
      })

      if (!response.ok) {
        setState({
          status: 'error',
          query: trimmedQuery,
          message:
            response.status === 503
              ? 'Find Case Law is currently unreachable. Cached results may still be available through standard search.'
              : 'Search could not complete the request.',
        })
        return
      }

      const body = (await response.json()) as AtlasFetchResponse
      setState(
        body.hits.length > 0
          ? { status: 'results', query: trimmedQuery, response: body }
          : { status: 'empty', query: trimmedQuery },
      )
    } catch {
      setState({
        status: 'error',
        query: trimmedQuery,
        message: 'Search could not reach the API.',
      })
    }
  }

  function openFilters() {
    setDraftCourt(court)
    setDraftDateFrom(dateFrom)
    setDraftDateTo(dateTo)
    setFiltersOpen(true)
  }

  function applyFilters() {
    setCourt(draftCourt)
    setDateFrom(draftDateFrom)
    setDateTo(draftDateTo)
    setFiltersOpen(false)
  }

  function clearFilters() {
    setDraftCourt('')
    setCourt('')
    setDraftDateFrom('')
    setDateFrom('')
    setDraftDateTo('')
    setDateTo('')
    setFiltersOpen(false)
  }

  const courtLabel = getAtlasCourtLabel(court)
  const activeFilterCount = countAtlasActiveFilters({ court, dateFrom, dateTo })

  return (
    <div className="shell-stack atlas-search">
      <section className="shell-page-heading">
        <div>
          <p className="shell-page-heading__eyebrow">Legal sources</p>
          <h1 className="shell-header__title">Search</h1>
        </div>
      </section>

      <Card className="atlas-search__panel">
        <form className="atlas-search__form" onSubmit={handleSubmit}>
          <div className="atlas-search__form-header">
            <span>Search legal sources</span>
            <button className="atlas-search__filters-button" type="button" onClick={openFilters}>
              Filters
              {activeFilterCount > 0 ? <strong>{activeFilterCount}</strong> : null}
            </button>
          </div>
          <div className="atlas-search__primary">
            <label className="atlas-search__field">
              <span className="atlas-search__visually-hidden">Search legal sources</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Potanina"
                name="query"
                type="search"
              />
            </label>
            <button className="atlas-search__button" disabled={state.status === 'loading'} type="submit">
              Search
            </button>
          </div>
          {activeFilterCount > 0 ? (
            <div className="atlas-search__active-filters" aria-label="Active filters">
              {court ? <span>{courtLabel}</span> : null}
              {dateFrom ? <span>From {dateFrom}</span> : null}
              {dateTo ? <span>To {dateTo}</span> : null}
            </div>
          ) : null}
        </form>
      </Card>

      {filtersOpen ? (
        <div className="atlas-filter-modal" role="dialog" aria-modal="true" aria-labelledby="atlas-filter-title">
          <button
            aria-label="Close search filters"
            className="atlas-filter-modal__backdrop"
            type="button"
            onClick={() => setFiltersOpen(false)}
          />
          <section className="atlas-filter-modal__panel">
            <header className="atlas-filter-modal__header">
              <div>
                <p>Search filters</p>
                <h2 id="atlas-filter-title">Refine results</h2>
              </div>
              <button type="button" onClick={() => setFiltersOpen(false)}>
                Close
              </button>
            </header>

            <div className="atlas-filter-modal__groups">
              <fieldset>
                <legend>Source</legend>
                <label className="atlas-filter-modal__field">
                  <span>Court or tribunal</span>
                  <select
                    value={draftCourt}
                    onChange={(event) => setDraftCourt(event.target.value)}
                    name="court-filter"
                  >
                    <option value="">All courts and tribunals</option>
                    {atlasCourtOptionGroups.map((group) => (
                      <optgroup label={group.label} key={group.label}>
                        {group.options.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </fieldset>

              <fieldset>
                <legend>Date decided</legend>
                <div className="atlas-filter-modal__date-grid">
                  <label className="atlas-filter-modal__field">
                    <span>From</span>
                    <input
                      value={draftDateFrom}
                      onChange={(event) => setDraftDateFrom(event.target.value)}
                      name="date-from-filter"
                      type="date"
                    />
                  </label>

                  <label className="atlas-filter-modal__field">
                    <span>To</span>
                    <input
                      value={draftDateTo}
                      onChange={(event) => setDraftDateTo(event.target.value)}
                      name="date-to-filter"
                      type="date"
                    />
                  </label>
                </div>
              </fieldset>
            </div>

            <footer className="atlas-filter-modal__actions">
              <button type="button" onClick={clearFilters}>
                Clear
              </button>
              <button type="button" onClick={applyFilters}>
                Apply filters
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <Card className="atlas-search__panel">
          <p className="shell-copy">Checking stored sources, then Find Case Law if needed.</p>
        </Card>
      ) : null}

      {state.status === 'empty' ? (
        <Card className="atlas-search__panel">
          <EmptyState title="No sources found" body={`No stored or Find Case Law results matched "${state.query}".`} />
        </Card>
      ) : null}

      {state.status === 'error' ? (
        <Card className="atlas-search__panel">
          <EmptyState title="Search unavailable" body={state.message} />
        </Card>
      ) : null}

      {state.status === 'results' ? (
        <section className="atlas-search__results" aria-live="polite">
          <p className="atlas-search__meta">
            {state.response.cached ? 'Cached result' : 'Fetched and cached'} - {state.response.indexedCount} indexed - {state.response.skippedCount} skipped
          </p>
          {state.response.hits.map((result) => {
            return (
              <article className="atlas-result" key={result.id}>
                <Link
                  to="/cases/$caseId"
                  params={{ caseId: result.id }}
                  className="atlas-result__summary"
                >
                  <span>
                    <strong>{result.title}</strong>
                    <small>
                      {result.neutralCitation} - {result.court} - {result.dateDecided}
                    </small>
                  </span>
                  <span className="atlas-result__actions">
                    <span className="atlas-result__toggle">Open case</span>
                    <span className="atlas-result__source">Stored source</span>
                  </span>
                </Link>
              </article>
            )
          })}
        </section>
      ) : null}
    </div>
  )
}

function readInitialSearchQuery() {
  if (typeof window === 'undefined') {
    return ''
  }

  const query = window.sessionStorage.getItem('ormont.search.initialQuery') ?? ''
  window.sessionStorage.removeItem('ormont.search.initialQuery')
  return query
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return text

  const index = text.toLowerCase().indexOf(normalizedQuery.toLowerCase())
  if (index < 0) return text

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + normalizedQuery.length)}</mark>
      {text.slice(index + normalizedQuery.length)}
    </>
  )
}
