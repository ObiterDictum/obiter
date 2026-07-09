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
      className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface p-5 data-[tone=warning]:border-warning/40 data-[tone=error]:border-danger/40"
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div className="min-w-0">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">{eyebrow}</p>
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted">{body}</p>
      </div>
      {action ? (
        <button
          className="shrink-0 rounded-md border border-line px-3 py-2 text-sm font-semibold text-brand transition-colors hover:bg-canvas"
          type="button"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ) : null}
    </section>
  )
}
