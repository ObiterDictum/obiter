import type { ReactNode } from 'react'

function cx(...tokens: Array<string | false | null | undefined>) {
  return tokens.filter(Boolean).join(' ')
}

interface AppFrameProps {
  header?: ReactNode
  sidebar: ReactNode
  children: ReactNode
}

export function AppFrame({ header, sidebar, children }: AppFrameProps) {
  return (
    <div className="ormont-frame">
      <aside className="ormont-frame__sidebar">{sidebar}</aside>
      <div className="ormont-frame__content">
        {header ? <header className="ormont-frame__header">{header}</header> : null}
        <main className="ormont-frame__main">{children}</main>
      </div>
    </div>
  )
}

interface CardProps {
  action?: ReactNode
  children: ReactNode
  className?: string
  eyebrow?: string
  title?: string
}

export function Card({ action, children, className, eyebrow, title }: CardProps) {
  return (
    <section className={cx('ormont-card', className)}>
      {eyebrow || title || action ? (
        <div className="ormont-card__header">
          <div>
            {eyebrow ? <p className="ormont-eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="ormont-card__title">{title}</h2> : null}
          </div>
          {action ? <div className="ormont-card__action">{action}</div> : null}
        </div>
      ) : null}
      <div className="ormont-card__body">{children}</div>
    </section>
  )
}

interface MetricTileProps {
  detail: string
  label: string
  tone?: 'ink' | 'sage' | 'amber' | 'rust'
  value: string
}

export function MetricTile({
  detail,
  label,
  tone = 'ink',
  value,
}: MetricTileProps) {
  return (
    <article className="ormont-metric" data-tone={tone}>
      <span className="ormont-metric__label">{label}</span>
      <strong className="ormont-metric__value">{value}</strong>
      <p className="ormont-metric__detail">{detail}</p>
    </article>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="ormont-metric-grid">{children}</div>
}

interface StatusPillProps {
  children: ReactNode
  tone?: 'ink' | 'sage' | 'amber' | 'rust'
}

export function StatusPill({ children, tone = 'ink' }: StatusPillProps) {
  return (
    <span className="ormont-status-pill" data-tone={tone}>
      {children}
    </span>
  )
}

interface EmptyStateProps {
  action?: ReactNode
  body: string
  title: string
}

export function EmptyState({ action, body, title }: EmptyStateProps) {
  return (
    <div className="ormont-empty-state">
      <h2 className="ormont-empty-state__title">{title}</h2>
      <p className="ormont-empty-state__body">{body}</p>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="ormont-section-title">{children}</h2>
}
