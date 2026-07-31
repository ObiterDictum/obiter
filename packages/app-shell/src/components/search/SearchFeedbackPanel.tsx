interface SearchFeedbackPanelProps {
  action?: {
    label: string
    onClick: () => void
  }
  body: string
  eyebrow: string
  title: string
  tone?: 'neutral' | 'warning' | 'error'
}

export function SearchFeedbackPanel({
  action,
  body,
  eyebrow,
  title,
  tone = 'neutral',
}: SearchFeedbackPanelProps) {
  return (
    <section
      className="flex items-start justify-between gap-4 border-b border-line px-5 py-5 data-[tone=warning]:border-warning/30 data-[tone=error]:border-danger/30 sm:px-6"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium tracking-wide text-muted">
          {eyebrow}
        </p>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">
          {body}
        </p>
      </div>
      {action ? (
        <button
          className="shrink-0 rounded-md px-2.5 py-1.5 text-sm font-medium text-brand transition-colors hover:bg-raised"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  )
}
