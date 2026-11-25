import { Info } from '@obiter/ui/icons'

export function FindCaseLawNotices() {
  return (
    <details
      open
      aria-label="Find Case Law licence notices"
      className="group rounded-md border border-line bg-fill text-meta text-ink"
    >
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-3 font-medium focus-visible:outline focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <Info aria-hidden size={16} className="shrink-0 text-muted" />
        <span>Find Case Law notices</span>
        <span className="ml-auto text-muted group-open:hidden" aria-hidden>
          +
        </span>
        <span
          className="ml-auto hidden text-muted group-open:inline"
          aria-hidden
        >
          −
        </span>
      </summary>
      <div className="space-y-1 border-t border-line px-3 py-2 leading-snug">
        <p className="font-medium">
          This material only partially represents court and tribunal activity.
          Find Case Law does not contain every judgment or decision.
        </p>
        <p>
          Crown copyright material reproduced by permission of The National
          Archives. The contents of the judgment can be used under the Open
          Justice - Licence.
        </p>
      </div>
    </details>
  )
}
