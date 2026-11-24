import type { ReactNode } from 'react'
import type { RedactionSpan } from '@obiter/redaction-policy'
import { Tooltip, TooltipContent, TooltipTrigger } from '@obiter/ui'
import {
  categoryClasses,
  categoryLabel,
  confidenceLabel,
  decisionMarkClass,
  sourceLabel,
  spanDecisionState,
} from './span-copy'
import type { RedactionRun } from './types'

const sourceClasses = {
  rampart_model: 'border-solid',
  rampart_deterministic: 'border-dotted',
  uk_supplement: 'border-dashed',
} satisfies Record<RedactionSpan['source'], string>

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
      className="max-w-[68ch] text-base leading-relaxed whitespace-pre-wrap wrap-anywhere"
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

export function Paper({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-center px-12 py-8 @max-pane:px-8">
      <div
        data-theme="light"
        className="w-full max-w-[860px] rounded-lg bg-paper px-10 py-10 text-body text-paper-ink shadow-md"
      >
        {children}
      </div>
    </div>
  )
}
