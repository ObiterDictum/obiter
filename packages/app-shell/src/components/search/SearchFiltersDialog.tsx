import { useState } from 'react'
import { CourtSelect } from './CourtSelect'

interface SearchFiltersDialogProps {
  court: string
  dateFrom: string
  dateTo: string
  onApply: (filters: { court: string; dateFrom: string; dateTo: string }) => void
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
    <div className="search-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="search-filter-title">
      <button
        aria-label="Close search filters"
        className="search-filter-dialog__backdrop"
        type="button"
        onClick={closeDialog}
      />
      <section className="search-filter-dialog__panel">
        <button
          aria-label="Close search filters"
          className="search-filter-dialog__close"
          type="button"
          onClick={closeDialog}
        >
          <span aria-hidden="true">×</span>
        </button>
        <header className="search-filter-dialog__header">
          <div>
            <p>Search filters</p>
            <h2 id="search-filter-title">Refine results</h2>
          </div>
        </header>

        <div className="search-filter-dialog__groups">
          <fieldset>
            <legend>Source</legend>
            <CourtSelect
              menuOpen={courtMenuOpen}
              onMenuOpenChange={setCourtMenuOpen}
              onValueChange={setDraftCourt}
              value={draftCourt}
            />
          </fieldset>

          <fieldset>
            <legend>Date decided</legend>
            <div className="search-filter-dialog__date-grid">
              <label className="search-filter-dialog__field">
                <span>From</span>
                <input
                  value={draftDateFrom}
                  onChange={(event) => setDraftDateFrom(event.target.value)}
                  onInput={(event) => setDraftDateFrom(event.currentTarget.value)}
                  name="date-from-filter"
                  type="date"
                />
              </label>

              <label className="search-filter-dialog__field">
                <span>To</span>
                <input
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

        <footer className="search-filter-dialog__actions">
          <button type="button" onClick={onClear}>
            Clear
          </button>
          <button
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
