import {
  courtOptionGroups,
  getCourtLabel,
} from './searchTypes'

interface CourtSelectProps {
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onValueChange: (value: string) => void
  value: string
}

export function CourtSelect({
  menuOpen,
  onMenuOpenChange,
  onValueChange,
  value,
}: CourtSelectProps) {
  function selectCourt(nextCourt: string) {
    onValueChange(nextCourt)
    onMenuOpenChange(false)
  }

  return (
    <div className="search-filter-dialog__field search-filter-dialog__field--court">
      <span>Court or tribunal</span>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        className="search-filter-dialog__select-trigger"
        type="button"
        onClick={() => onMenuOpenChange(!menuOpen)}
      >
        <span>{getCourtLabel(value)}</span>
        <span aria-hidden="true" className="search-filter-dialog__select-chevron" />
      </button>
      {menuOpen ? (
        <div className="search-filter-dialog__court-menu" role="listbox" aria-label="Court or tribunal">
          <button
            aria-selected={value === ''}
            className="search-filter-dialog__court-option search-filter-dialog__court-option--all"
            role="option"
            type="button"
            onClick={() => selectCourt('')}
          >
            All courts and tribunals
          </button>
          {courtOptionGroups.map((group) => (
            <div className="search-filter-dialog__court-group" key={group.label}>
              <p>{group.label}</p>
              {group.options.map((option) => (
                <button
                  aria-selected={value === option.code}
                  className="search-filter-dialog__court-option"
                  key={option.code}
                  role="option"
                  type="button"
                  onClick={() => selectCourt(option.code)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
