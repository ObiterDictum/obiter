import {
  atlasCourtOptionGroups,
  getAtlasCourtLabel,
} from './atlasSearchTypes'

interface AtlasCourtSelectProps {
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onValueChange: (value: string) => void
  value: string
}

export function AtlasCourtSelect({
  menuOpen,
  onMenuOpenChange,
  onValueChange,
  value,
}: AtlasCourtSelectProps) {
  function selectCourt(nextCourt: string) {
    onValueChange(nextCourt)
    onMenuOpenChange(false)
  }

  return (
    <div className="atlas-filter-modal__field atlas-filter-modal__field--court">
      <span>Court or tribunal</span>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        className="atlas-filter-modal__select-trigger"
        type="button"
        onClick={() => onMenuOpenChange(!menuOpen)}
      >
        <span>{getAtlasCourtLabel(value)}</span>
        <span aria-hidden="true" className="atlas-filter-modal__select-chevron" />
      </button>
      {menuOpen ? (
        <div className="atlas-filter-modal__court-menu" role="listbox" aria-label="Court or tribunal">
          <button
            aria-selected={value === ''}
            className="atlas-filter-modal__court-option atlas-filter-modal__court-option--all"
            role="option"
            type="button"
            onClick={() => selectCourt('')}
          >
            All courts and tribunals
          </button>
          {atlasCourtOptionGroups.map((group) => (
            <div className="atlas-filter-modal__court-group" key={group.label}>
              <p>{group.label}</p>
              {group.options.map((option) => (
                <button
                  aria-selected={value === option.code}
                  className="atlas-filter-modal__court-option"
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
