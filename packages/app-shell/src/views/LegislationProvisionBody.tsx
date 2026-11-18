import { Link } from '@tanstack/react-router'
import { EmptyState } from '@obiter/ui'
import type {
  LegislationProvisionSubsection,
  LegislationStatus,
} from '@obiter/contracts/legislation-reader'
import { provisionResultLocation } from '../legislation-navigation'
import { legislationStatusDisplay } from '../legislation-status'

export function LegislationProvisionBody({
  provision,
  documentIdentity,
  provisionLabel,
  title,
  heading,
  standalone = false,
}: {
  provision: {
    legislationStatus: LegislationStatus
    officialUrl: string
    repealedFrom?: string
    notice?: string
    text?: string
    subsections?: LegislationProvisionSubsection[]
  }
  documentIdentity: string
  provisionLabel: string
  title: string
  heading?: string
  standalone?: boolean
}) {
  const repealed = provision.legislationStatus === 'repealed'
  const withheld = provision.legislationStatus === 'amended_not_held'
  const status = legislationStatusDisplay(
    provision.legislationStatus,
    provision.repealedFrom,
  )
  return repealed ? (
    <div
      className="rounded-lg bg-fill px-6 py-4"
      role="status"
      data-legislation-status="repealed"
    >
      <p className="text-item text-ink">{status.label}</p>
      <p className="mt-1 text-meta text-muted">{provision.notice}</p>
      <a
        className="mt-2 inline-block text-meta text-ink underline"
        href={provision.officialUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        Read the official record
      </a>
    </div>
  ) : withheld ? (
    <div
      className="rounded-lg bg-warning-soft px-6 py-4"
      role="alert"
      data-legislation-status="amended_not_held"
    >
      <p className="text-item text-warning">Amended wording withheld</p>
      <p className="mt-1 text-meta text-muted">{provision.notice}</p>
      <a
        className="mt-2 inline-block text-meta text-ink underline"
        href={provision.officialUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        Read the official revised provision
      </a>
    </div>
  ) : provision.text || provision.subsections ? (
    <article
      role="document"
      aria-label={[provisionLabel, heading, title].filter(Boolean).join(' ')}
      data-legislation-status="current"
      className={
        standalone
          ? 'rounded-lg bg-paper px-8 py-10 font-serif text-paper-ink shadow-md md:px-12'
          : 'font-serif text-paper-ink'
      }
    >
      {standalone && heading ? (
        <h2 className="mb-4 font-serif text-section text-paper-ink">
          {heading}
        </h2>
      ) : null}
      {provision.text ? (
        <p className="whitespace-pre-wrap text-[16px] leading-[1.85]">
          {provision.text}
        </p>
      ) : null}
      {provision.subsections ? (
        <div className="mt-2 flex flex-col">
          {provision.subsections.map((subsection) => (
            <SubsectionNode
              key={subsection.labelPath}
              node={subsection}
              documentIdentity={documentIdentity}
              parentLabel={provisionLabel}
              depth={0}
            />
          ))}
        </div>
      ) : null}
    </article>
  ) : (
    <EmptyState
      title="No provision text"
      body="No wording is held for this provision."
    />
  )
}

function SubsectionNode({
  node,
  documentIdentity,
  parentLabel,
  depth,
}: {
  node: LegislationProvisionSubsection
  documentIdentity: string
  parentLabel: string
  depth: number
}) {
  const label = node.label.startsWith(parentLabel)
    ? node.label.slice(parentLabel.length).trim()
    : node.label
  const withheld = node.legislationStatus === 'amended_not_held'
  const repealed = node.legislationStatus === 'repealed'
  return (
    <div className={depth > 0 ? 'ml-6 border-l border-line pl-4' : undefined}>
      <p className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2 py-1 text-[16px] leading-[1.85]">
        <Link
          {...provisionResultLocation({
            documentIdentity,
            labelPath: node.labelPath,
            canonicalUrl: node.href,
          })}
          aria-label={`${node.label} of this provision`}
          title={node.label}
          className="pt-0.5 text-right font-sans text-meta text-paper-muted tabular-nums underline-offset-2 hover:underline"
        >
          {label}
        </Link>
        {repealed ? (
          <span className="text-meta text-paper-muted">
            {legislationStatusDisplay('repealed', node.repealedFrom).label}.
          </span>
        ) : withheld ? (
          <span className="text-meta text-paper-muted">
            Wording withheld: amendments are recorded but not applied.{' '}
            <a
              className="text-paper-ink underline"
              href={`https://www.legislation.gov.uk/${documentIdentity}/${node.labelPath}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Read the official revised provision
            </a>
          </span>
        ) : (
          <span className="whitespace-pre-wrap">
            {node.text ?? 'No stored wording for this level.'}
          </span>
        )}
      </p>
      {node.children.map((child) => (
        <SubsectionNode
          key={child.labelPath}
          node={child}
          documentIdentity={documentIdentity}
          parentLabel={node.label}
          depth={depth + 1}
        />
      ))}
    </div>
  )
}
