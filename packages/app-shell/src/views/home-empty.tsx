import { Link, useNavigate } from '@tanstack/react-router'
import { StatusDot, buttonClassName } from '@obiter/ui'
import { BookOpen, MagnifyingGlass, Scales, Upload } from '@obiter/ui/icons'
import { useState, type FormEvent } from 'react'
import { getRecentLegalSearches } from '../legal-search-recents'
import { CreateMatterDialog } from './create-matter-dialog'

const SUGGESTED_SEARCHES = [
  {
    query: 'Wood v Capita Insurance Services Ltd',
    label: 'Wood v Capita Insurance Services Ltd',
    detail: '[2017] UKSC 24',
    icon: Scales,
  },
  {
    query: 'Rock Advertising v MWB',
    label: 'Rock Advertising v MWB',
    detail: '[2018] UKSC 24',
    icon: Scales,
  },
  {
    query: 'Secretary of State for Business and Trade v Mercer',
    label: 'Secretary of State for Business and Trade v Mercer',
    detail: '[2024] UKSC 12',
    icon: Scales,
  },
  {
    query: 'Limitation Act 1980 section 5',
    label: 'Limitation Act 1980, s. 5',
    detail: 'Act provision',
    icon: BookOpen,
  },
]

export function HomeEmpty() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const recentSearches =
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage)

  function search(term: string) {
    const trimmed = term.trim()
    if (!trimmed) return
    window.sessionStorage.setItem('obiter.search.initialQuery', trimmed)
    void navigate({ to: '/search' })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    search(query)
  }

  return (
    <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-labelledby="setup">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="setup" className="text-section text-ink">
            Set up your workspace
          </h2>
          <span className="text-meta text-subtle">
            Three steps, in any order
          </span>
        </div>

        <ol className="list-none rounded-lg bg-surface" role="list">
          <Step
            number={1}
            title="Create your first matter"
            text="A matter holds the client file, its documents and the sources you rely on. You can change the details later."
          >
            <CreateMatterDialog
              trigger="New matter"
              variant="primary"
              size="md"
            />
          </Step>
          <Step
            number={2}
            title="Add a document"
            text="Open a matter and upload a Word document or PDF. Every save becomes a stored version you can compare and share."
          >
            <Link
              to="/matters"
              className={buttonClassName({ variant: 'secondary' })}
            >
              <Upload size={16} aria-hidden /> Choose a matter
            </Link>
          </Step>
          <Step
            number={3}
            title="Search the law"
            text="Find UK case law and legislation, then keep what you rely on with the matter it belongs to."
          >
            <Link
              to="/search"
              className={buttonClassName({ variant: 'ghost' })}
            >
              <MagnifyingGlass size={16} aria-hidden /> Search the law
            </Link>
          </Step>
        </ol>

        <p className="mt-4 max-w-[68ch] text-meta text-muted">
          Nothing here is permanent: you can rename a matter or delete a
          document at any time.
        </p>
      </section>

      <aside
        aria-label="Getting started"
        className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] max-compact:grid-cols-1 wide:grid-cols-1"
      >
        <section aria-labelledby="try-search" className="rounded-lg bg-surface">
          <div className="flex items-center justify-between gap-4 px-6 pt-6 pb-4">
            <h2 id="try-search" className="text-item text-ink">
              Try a search
            </h2>
            <span className="text-meta text-subtle">No matter needed</span>
          </div>
          <div className="px-6">
            <form
              onSubmit={handleSubmit}
              className="flex h-control items-center gap-2 rounded-md border border-line bg-raised px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring"
            >
              <MagnifyingGlass
                size={16}
                className="shrink-0 text-subtle"
                aria-hidden
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Case, citation or Act"
                aria-label="Search the law"
                className="min-w-0 flex-1 bg-transparent text-meta text-ink outline-none placeholder:text-subtle"
              />
            </form>
          </div>
          {recentSearches.length > 0 ? (
            <ul aria-label="Recent searches" className="mt-4">
              {recentSearches.slice(0, 4).map((recentQuery) => (
                <li key={recentQuery}>
                  <SearchRow
                    label={recentQuery}
                    detail="Recent search"
                    icon={MagnifyingGlass}
                    onSelect={() => search(recentQuery)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <ul aria-label="Suggested searches" className="mt-4">
              {SUGGESTED_SEARCHES.map((suggestion) => (
                <li key={suggestion.query}>
                  <SearchRow
                    label={suggestion.label}
                    detail={suggestion.detail}
                    icon={suggestion.icon}
                    onSelect={() => search(suggestion.query)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-labelledby="what-appears"
          className="rounded-lg bg-surface"
        >
          <div className="px-6 pt-6 pb-4">
            <h2 id="what-appears" className="text-item text-ink">
              What appears here
            </h2>
          </div>
          <div className="px-6 pb-6">
            <p className="text-body text-muted">
              Once work starts, this page becomes your queue. It shows only the
              things that need a person.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <StatusDot tone="danger">
                Flagged citations, with the reason
              </StatusDot>
              <StatusDot tone="info">
                Redactions waiting for a decision
              </StatusDot>
              <StatusDot tone="warning">
                Citations only a person can judge
              </StatusDot>
            </div>
          </div>
        </section>
      </aside>
    </div>
  )
}

function SearchRow({
  label,
  detail,
  icon: Icon,
  onSelect,
}: {
  label: string
  detail: string
  icon: typeof MagnifyingGlass
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full min-h-row items-center gap-3 px-6 py-4 text-left hover:bg-hover"
    >
      <span
        className="grid size-7 shrink-0 place-items-center rounded-sm bg-fill text-subtle"
        aria-hidden="true"
      >
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-item text-ink">{label}</span>
        <span className="mt-1 block text-meta text-muted">{detail}</span>
      </span>
    </button>
  )
}

function Step({
  number,
  title,
  text,
  children,
}: {
  number: number
  title: string
  text: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-start gap-4 p-6 [&+li]:border-t [&+li]:border-line">
      <span
        className="mt-1 grid size-6 shrink-0 place-items-center rounded-pill bg-fill text-caption text-muted tabular-nums"
        aria-hidden="true"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-item text-ink">{title}</h3>
        <p className="mt-1 max-w-[60ch] text-meta text-muted">{text}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  )
}
