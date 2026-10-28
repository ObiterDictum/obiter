import { type FormEvent, type RefObject } from 'react'
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { Button } from '@obiter/ui'

interface SearchCommandBarProps {
  isSearching: boolean
  inputRef?: RefObject<HTMLInputElement | null>
  onClear: () => void
  onQueryChange: (query: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  query: string
}

export function SearchCommandBar({
  isSearching,
  inputRef,
  onClear,
  onQueryChange,
  onSubmit,
  query,
}: SearchCommandBarProps) {
  return (
    <form
      className="flex w-full max-w-[780px] flex-col gap-2"
      onSubmit={onSubmit}
    >
      <div className="flex min-h-control-large w-full items-center gap-3 rounded-lg bg-surface px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand">
        <MagnifyingGlass
          aria-hidden="true"
          size={18}
          className="shrink-0 text-subtle"
        />
        <label className="sr-only" htmlFor="legal-sources-search">
          Search case law and legislation
        </label>
        <input
          ref={inputRef}
          id="legal-sources-search"
          className="min-h-7 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Act, citation, party, or point of law"
          name="query"
          type="search"
          autoFocus
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-hover hover:text-ink"
            onClick={onClear}
          >
            <X aria-hidden size={14} />
          </button>
        ) : null}
        <Button type="submit" size="sm" loading={isSearching}>
          {isSearching ? 'Searching…' : 'Search'}
        </Button>
      </div>
    </form>
  )
}
