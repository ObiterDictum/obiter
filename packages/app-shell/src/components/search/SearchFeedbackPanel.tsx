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
    <section className="legal-search-feedback" data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <div>
        <p className="legal-search-feedback__eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      {action ? (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </section>
  )
}
