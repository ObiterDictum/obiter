import { useState } from 'react'
import { CourtSelect } from './CourtSelect'

interface SearchFiltersDialogProps {
  court: string
  dateFrom: string
  dateTo: string
  onApply: (filters: {
    court: string
    dateFrom: string
    dateTo: string
  }) => void
  onClear: () => void
  onClose: () => void
}

export function SearchFiltersDialog({
  court,
  dateFrom,
  dateTo,
  onApply,
  onClear,
  onClose,
}: SearchFiltersDialogProps) {
  const [draftCourt, setDraftCourt] = useState(court)
  const [draftDateFrom, setDraftDateFrom] = useState(dateFrom)
  const [draftDateTo, setDraftDateTo] = useState(dateTo)
  const [courtMenuOpen, setCourtMenuOpen] = useState(false)

  function closeDialog() {
    setCourtMenuOpen(false)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-7"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-filter-title"
    >
      <button
        aria-label="Close search filters"
        type="button"
        className="absolute inset-0 cursor-default bg-overlay"
        onClick={closeDialog}
      />
      <section className="relative grid w-full max-w-[500px] gap-4 rounded-lg border border-line-strong bg-raised p-5 shadow-lg">
        <button
          aria-label="Close search filters"
          type="button"
          className="absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-canvas hover:text-ink"
          onClick={closeDialog}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </button>
        <header className="pr-9">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">
            Search filters
          </p>
          <h2
            className="mt-1 text-lg font-semibold text-ink"
            id="search-filter-title"
          >
            Refine results
          </h2>
        </header>

        <div className="grid gap-3.5">
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
              Source
            </legend>
            <CourtSelect
              menuOpen={courtMenuOpen}
              onMenuOpenChange={setCourtMenuOpen}
              onValueChange={setDraftCourt}
              value={draftCourt}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted">
              Date decided
            </legend>
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-ink">
                <span>From</span>
                <input
                  className="min-h-[31px] rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink outline-none focus:border-brand"
                  value={draftDateFrom}
                  onChange={(event) => setDraftDateFrom(event.target.value)}
                  onInput={(event) =>
                    setDraftDateFrom(event.currentTarget.value)
                  }
                  name="date-from-filter"
                  type="date"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-xs font-medium text-ink">
                <span>To</span>
                <input
                  className="min-h-[31px] rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink outline-none focus:border-brand"
                  value={draftDateTo}
                  onChange={(event) => setDraftDateTo(event.target.value)}
                  onInput={(event) => setDraftDateTo(event.currentTarget.value)}
                  name="date-to-filter"
                  type="date"
                />
              </label>
            </div>
          </fieldset>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line pt-3">
          <button
            className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-muted transition-colors hover:bg-canvas hover:text-ink"
            type="button"
            onClick={onClear}
          >
            Clear
          </button>
          <button
            className="rounded-md border border-brand px-3 py-1.5 text-xs font-semibold text-brand transition-colors hover:bg-brand hover:text-brand-fg"
            type="button"
            onClick={() =>
              onApply({
                court: draftCourt,
                dateFrom: draftDateFrom,
                dateTo: draftDateTo,
              })
            }
          >
            Apply filters
          </button>
        </footer>
      </section>
    </div>
  )
}
