import type { ReactNode } from 'react'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import {
  categoryLabel,
  confidenceLabel,
  decisionMarkClass,
  sourceLabel,
  spanDecisionState,
} from './span-copy'
import type { RedactionRun } from './types'

export const categoryClasses = {
  person_name: 'bg-span-person-name text-span-person-name-fg',
  email: 'bg-span-email text-span-email-fg',
  phone: 'bg-span-phone text-span-phone-fg',
  address: 'bg-span-address text-span-address-fg',
  date: 'bg-span-date text-span-date-fg',
  government_id: 'bg-span-government-id text-span-government-id-fg',
  account_number: 'bg-span-account-number text-span-account-number-fg',
  passport: 'bg-span-passport text-span-passport-fg',
  drivers_license: 'bg-span-drivers-license text-span-drivers-license-fg',
  url: 'bg-span-url text-span-url-fg',
  ip_address: 'bg-span-ip-address text-span-ip-address-fg',
  national_insurance:
    'bg-span-national-insurance text-span-national-insurance-fg',
  case_reference: 'bg-span-case-reference text-span-case-reference-fg',
  organisation_name: 'bg-span-organisation-name text-span-organisation-name-fg',
  secret: 'bg-span-secret text-span-secret-fg',
} satisfies Record<RedactionSpan['category'], string>

const sourceClasses = {
  rampart_model: 'border-solid',
  rampart_deterministic: 'border-dotted',
  uk_supplement: 'border-dashed',
} satisfies Record<RedactionSpan['source'], string>

/**
 * Colour is a reading aid, never the only carrier of the category: the legend
 * below names every colour in use, each span states its category on hover and
 * on focus, and a screen reader reads it from the span's own text.
 */
export function CategoryLegend({
  categories,
}: {
  categories: RedactionSpan['category'][]
}) {
  if (!categories.length) return null
  return (
    <ul
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted"
      aria-label="Category colours in this document"
    >
      {categories.map((category) => (
        <li key={category} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={['size-2.5 rounded-xs', categoryClasses[category]].join(
              ' ',
            )}
          />
          {categoryLabel[category]}
        </li>
      ))}
    </ul>
  )
}

/**
 * The source text as the reviewer reads it. A span is painted by category (the
 * contract's palette) and its decision state is never carried by colour alone:
 * an accepted span keeps its fill, a kept span fades and keeps a dashed
 * baseline, and an undecided span carries a warning outline. The decision is
 * also stated in words in the panel and in the decision bar.
 */
export function HighlightedText({
  text,
  run,
  selectedId,
  onSelect,
}: {
  text: string
  run: RedactionRun
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const spans = [...run.spans].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
  let position = 0
  return (
    <article
      className="max-w-[68ch] text-base leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
      aria-label="Original document text"
    >
      {spans.map((span) => {
        if (span.start < position || span.end > text.length) return null
        const before = text.slice(position, span.start)
        position = span.end
        const state = spanDecisionState(run.decisions[span.id]?.decision)
        return (
          <span key={span.id}>
            {before}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-span-id={span.id}
                    onClick={() => onSelect(span.id)}
                    className={[
                      'inline rounded-sm border-b-2 px-0.5 text-left align-baseline',
                      'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      categoryClasses[span.category],
                      sourceClasses[span.source],
                      decisionMarkClass[state],
                      selectedId === span.id ? 'ring-2 ring-ring' : '',
                    ].join(' ')}
                    aria-pressed={selectedId === span.id}
                  />
                }
              >
                {span.text}
                <span className="sr-only">
                  , {categoryLabel[span.category]}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {categoryLabel[span.category]} ·{' '}
                {sourceLabel[span.source].toLowerCase()} ·{' '}
                {confidenceLabel[span.confidence].toLowerCase()} confidence
              </TooltipContent>
            </Tooltip>
          </span>
        )
      })}
      {text.slice(position)}
    </article>
  )
}

/**
 * The page is paper in both themes, so the span palette is pinned to the light
 * token set for this subtree: a dark-theme span tint would paint a dark block on
 * white paper and read as a redaction that is not there.
 */
export function Paper({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-12 py-8 max-compact:px-8">
      <div
        data-theme="light"
        className="w-full max-w-[860px] rounded-lg bg-paper px-10 py-10 text-body text-paper-ink shadow-md"
      >
        {children}
      </div>
    </div>
  )
}
