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
    <div className="obiter-frame">
      <aside className="obiter-frame__sidebar">{sidebar}</aside>
      <div className="obiter-frame__content">
        {header ? <header className="obiter-frame__header">{header}</header> : null}
        <main className="obiter-frame__main">{children}</main>
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
    <section className={cx('obiter-card', className)}>
      {eyebrow || title || action ? (
        <div className="obiter-card__header">
          <div>
            {eyebrow ? <p className="obiter-eyebrow">{eyebrow}</p> : null}
            {title ? <h2 className="obiter-card__title">{title}</h2> : null}
          </div>
          {action ? <div className="obiter-card__action">{action}</div> : null}
        </div>
      ) : null}
      <div className="obiter-card__body">{children}</div>
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
    <article className="obiter-metric" data-tone={tone}>
      <span className="obiter-metric__label">{label}</span>
      <strong className="obiter-metric__value">{value}</strong>
      <p className="obiter-metric__detail">{detail}</p>
    </article>
  )
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="obiter-metric-grid">{children}</div>
}

interface StatusPillProps {
  children: ReactNode
  tone?: 'ink' | 'sage' | 'amber' | 'rust'
}

export function StatusPill({ children, tone = 'ink' }: StatusPillProps) {
  return (
    <span className="obiter-status-pill" data-tone={tone}>
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
    <div className="obiter-empty-state">
      <h2 className="obiter-empty-state__title">{title}</h2>
      <p className="obiter-empty-state__body">{body}</p>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="obiter-section-title">{children}</h2>
}
