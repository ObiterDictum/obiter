import type { KeyboardEvent, RefObject } from 'react'
import type { SpanCategory } from '@obiter/contracts'
import {
  Select,
  StatusDot,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@obiter/ui'
import { Lock } from '@obiter/ui/icons'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import {
  categoryLabel,
  confidenceLabel,
  decisionRecord,
  decisionStateLabel,
  decisionStateTone,
  detectionSummary,
  sourceLabel,
  spanDecisionState,
} from './span-copy'

export type SpanFilter = 'all' | 'pending' | 'rejected' | 'accepted'

const spanFilters: readonly string[] = [
  'all',
  'pending',
  'rejected',
  'accepted',
]

function isSpanFilter(value: string | null): value is SpanFilter {
  return value !== null && spanFilters.includes(value)
}

export function ReviewPanel({
  spans,
  decisions,
  counts,
  currentUserId,
  bySource,
  filter,
  onFilterChange,
  category,
  onCategoryChange,
  source,
  onSourceChange,
  categories,
  selectedId,
  onSelect,
  onKeyDown,
  listRef,
  pageFor,
  pageCount,
}: {
  spans: RedactionSpan[]
  decisions: Decisions
  counts: Record<'accepted' | 'rejected' | 'pseudonymised' | 'pending', number>
  currentUserId: string | undefined
  bySource: {
    rampartModel: number
    rampartDeterministic: number
    ukSupplement: number
  }
  filter: SpanFilter
  onFilterChange: (filter: SpanFilter) => void
  category: string
  onCategoryChange: (category: string) => void
  source: string
  onSourceChange: (source: string) => void
  categories: SpanCategory[]
  selectedId: string | null
  onSelect: (spanId: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
  listRef: RefObject<HTMLDivElement | null>
  pageFor: (span: RedactionSpan) => number | null
  pageCount: number | null
}) {
  const decided =
    counts.accepted + counts.rejected + counts.pseudonymised + counts.pending
  return (
    <aside
      className="flex min-h-0 w-panel max-w-full shrink-0 flex-col border-l border-line bg-surface max-compact:w-[320px]"
      aria-label="Detected spans"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-6 py-3">
        <h2 className="text-item text-ink">Detected spans</h2>
        <span className="text-meta tabular-nums text-muted">{decided}</span>
      </div>

      <p className="flex shrink-0 items-start gap-2 border-b border-line px-6 py-3 text-caption text-muted">
        <Lock size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          <span className="text-ink">
            Original text is visible to reviewers only.
          </span>{' '}
          Do not share this screen or export the schedule outside the matter.
        </span>
      </p>

      <Tabs
        value={filter}
        onValueChange={(value) => {
          if (isSpanFilter(value)) onFilterChange(value)
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0 border-b border-line px-6 py-3">
          <TabsList aria-label="Filter spans">
            <TabsTrigger value="all">All {decided}</TabsTrigger>
            <TabsTrigger value="pending">
              Unreviewed {counts.pending}
            </TabsTrigger>
            <TabsTrigger value="rejected">Kept {counts.rejected}</TabsTrigger>
            <TabsTrigger value="accepted">
              Redacted {counts.accepted}
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-line px-6 py-3">
          <Select
            aria-label="Filter by category"
            value={category}
            onValueChange={(value) => onCategoryChange(value ?? 'all')}
            options={[
              { value: 'all', label: 'All categories' },
              ...categories.map((value) => ({
                value,
                label: categoryLabel[value],
              })),
            ]}
          />
          <Select
            aria-label="Filter by how it was detected"
            value={source}
            onValueChange={(value) => onSourceChange(value ?? 'all')}
            options={[
              { value: 'all', label: 'All detectors' },
              ...Object.entries(sourceLabel).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
        </div>
        <TabsContent
          value={filter}
          className="min-h-0 flex-1 overflow-y-auto p-0"
        >
          <div
            ref={listRef}
            role="listbox"
            aria-label="Detected spans"
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            {spans.length === 0 ? (
              <p className="px-6 py-4 text-meta text-muted">
                No spans match this filter.
              </p>
            ) : (
              spans.map((span) => {
                const record = decisions[span.id]
                const state = spanDecisionState(record?.decision)
                const page = pageFor(span)
                return (
                  <button
                    type="button"
                    key={span.id}
                    onClick={() => onSelect(span.id)}
                    className={cn(
                      'flex min-h-row w-full flex-col gap-1 border-b border-line px-6 py-3 text-left transition-colors hover:bg-raised',
                      selectedId === span.id && 'bg-raised',
                    )}
                    role="option"
                    aria-selected={selectedId === span.id}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-caption text-subtle">
                        {categoryLabel[span.category]}
                      </span>
                      <StatusDot tone={decisionStateTone[state]}>
                        {decisionStateLabel[state]}
                      </StatusDot>
                    </span>
                    <span className="text-item break-words text-ink">
                      {span.text}
                    </span>
                    <span className="text-caption text-subtle">
                      {page === null
                        ? ''
                        : `Page ${page}${pageCount === null ? '' : ` of ${pageCount}`} · `}
                      {sourceLabel[span.source].toLowerCase()} ·{' '}
                      {confidenceLabel[span.confidence].toLowerCase()}{' '}
                      confidence
                    </span>
                    {record ? (
                      <span className="text-caption text-ink">
                        {decisionRecord(record, currentUserId)}
                      </span>
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
        </TabsContent>
      </Tabs>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-6 py-3">
        <p className="text-caption text-muted">{detectionSummary(bySource)}</p>
        <p className="text-caption text-subtle">
          The redaction schedule is a separate file. It lists each decision
          without the removed words.
        </p>
      </div>
    </aside>
  )
}
