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
    <div className="relative flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">Court or tribunal</span>
      <button
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        className="flex min-h-[31px] w-full items-center justify-between rounded-md border border-line bg-canvas px-2.5 text-xs font-medium text-ink outline-none focus:border-brand"
        type="button"
        onClick={() => onMenuOpenChange(!menuOpen)}
      >
        <span className="truncate">{getCourtLabel(value)}</span>
        <span
          aria-hidden="true"
          className="ml-2 h-1.5 w-1.5 border-b-2 border-r-2 border-current opacity-70"
          style={{ transform: 'translateY(-2px) rotate(45deg)' }}
        />
      </button>
      {menuOpen ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+5px)] z-10 grid max-h-[236px] gap-1.5 overflow-y-auto rounded-md border border-brand bg-raised p-1.5 shadow-lg"
          role="listbox"
          aria-label="Court or tribunal"
        >
          <button
            aria-selected={value === ''}
            className="rounded-sm px-2 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:bg-canvas aria-selected:bg-brand/10 aria-selected:text-brand"
            role="option"
            type="button"
            onClick={() => selectCourt('')}
          >
            All courts and tribunals
          </button>
          {courtOptionGroups.map((group) => (
            <div className="flex flex-col gap-0.5" key={group.label}>
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </p>
              {group.options.map((option) => (
                <button
                  aria-selected={value === option.code}
                  className="rounded-sm px-2 py-1.5 text-left text-xs font-medium text-ink transition-colors hover:bg-canvas aria-selected:bg-brand/10 aria-selected:text-brand"
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
