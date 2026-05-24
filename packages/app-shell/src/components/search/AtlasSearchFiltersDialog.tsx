import { useState } from 'react'
import { AtlasCourtSelect } from './AtlasCourtSelect'

interface AtlasSearchFiltersDialogProps {
  court: string
  dateFrom: string
  dateTo: string
  onApply: (filters: { court: string; dateFrom: string; dateTo: string }) => void
  onClear: () => void
  onClose: () => void
}

export function AtlasSearchFiltersDialog({
  court,
  dateFrom,
  dateTo,
  onApply,
  onClear,
  onClose,
}: AtlasSearchFiltersDialogProps) {
  const [draftCourt, setDraftCourt] = useState(court)
  const [draftDateFrom, setDraftDateFrom] = useState(dateFrom)
  const [draftDateTo, setDraftDateTo] = useState(dateTo)
  const [courtMenuOpen, setCourtMenuOpen] = useState(false)

  function closeDialog() {
    setCourtMenuOpen(false)
    onClose()
  }

  return (
    <div className="atlas-filter-modal" role="dialog" aria-modal="true" aria-labelledby="atlas-filter-title">
      <button
        aria-label="Close search filters"
        className="atlas-filter-modal__backdrop"
        type="button"
        onClick={closeDialog}
      />
      <section className="atlas-filter-modal__panel">
        <button
          aria-label="Close search filters"
          className="atlas-filter-modal__close"
          type="button"
          onClick={closeDialog}
        >
          <span aria-hidden="true">×</span>
        </button>
        <header className="atlas-filter-modal__header">
          <div>
            <p>Search filters</p>
            <h2 id="atlas-filter-title">Refine results</h2>
          </div>
        </header>

        <div className="atlas-filter-modal__groups">
          <fieldset>
            <legend>Source</legend>
            <AtlasCourtSelect
              menuOpen={courtMenuOpen}
              onMenuOpenChange={setCourtMenuOpen}
              onValueChange={setDraftCourt}
              value={draftCourt}
            />
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
