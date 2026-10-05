import { type ReactNode } from 'react'

export interface SearchCourtShortcut {
  code: string
  label: string
}

interface SearchIdleExtrasProps {
  courtLabel: string
  courtShortcuts: SearchCourtShortcut[]
  onCourtShortcut: (court: string) => void
}

const searchTips = [
  { label: 'Case name', example: 'Potanina v Potanin' },
  { label: 'Neutral citation', example: '[2024] UKSC 3' },
  { label: 'Keyword', example: 'beneficial ownership' },
]

/**
 * Idle-only copy under the centered search field. The command bar itself is
 * owned by LegalSearchView so it does not remount when a query starts.
 */
export function SearchIdleExtras({
  courtLabel,
  courtShortcuts,
  onCourtShortcut,
}: SearchIdleExtrasProps) {
  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <IdleBlock title="Court shortcuts">
        <div className="flex flex-wrap justify-center gap-1.5">
          {courtShortcuts.map((shortcut) => (
            <button
              className="rounded-md px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-raised"
              type="button"
              key={shortcut.code}
              onClick={() => onCourtShortcut(shortcut.code)}
            >
              {shortcut.label}
            </button>
          ))}
        </div>
        <p className="text-center text-sm leading-relaxed text-muted">
          {courtLabel === 'All courts and tribunals'
            ? 'Choose a court, then enter a search term.'
            : `Filtering by ${courtLabel}. Enter a search term to search within that court.`}
        </p>
      </IdleBlock>

      <IdleBlock title="Try searching">
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {searchTips.map((tip) => (
            <li
              className="flex flex-col gap-0.5 text-center sm:text-left"
              key={tip.label}
            >
              <span className="text-[11px] text-muted">{tip.label}</span>
              <span className="text-sm font-medium text-ink">
                {tip.example}
              </span>
            </li>
          ))}
        </ul>
      </IdleBlock>
    </div>
  )
}

/** @deprecated Prefer SearchIdleExtras — kept as alias for existing imports. */
export const SearchIdleState = SearchIdleExtras

function IdleBlock({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-6">
      <p className="text-center text-[11px] font-medium tracking-wide text-muted uppercase">
        {title}
      </p>
      {children}
    </div>
  )
}
