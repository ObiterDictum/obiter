import { useState } from 'react'
import {
  CaretLeft,
  CaretRight,
  Check,
  DotsThree,
  Warning,
  X,
} from '@phosphor-icons/react'
import type { SpanDecision } from '@obiter/contracts'
import type { Decisions, RedactionSpan } from '@obiter/redaction-policy'
import {
  Button,
  KeyboardHint,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  StatusDot,
} from '@obiter/ui'
import {
  CONFIDENCE_CAVEAT,
  categoryLabel,
  confidenceExplanation,
  confidenceLabel,
  decisionDescription,
  decisionLabel,
  decisionRecord,
  decisionStateLabel,
  decisionStateTone,
  sourceExplanation,
  spanDecisionState,
} from './span-copy'

/**
 * The decision bar. It states the span under review, what the detector found,
 * who decided it and when, and only then offers a decision — the reviewer sees
 * the evidence and the consequence on the same line as the button.
 *
 * Placement: Previous/Next move the selection through the same ordered list the
 * panel shows, so a reviewer can walk a run without touching the panel.
 */
export function DecisionBar({
  span,
  position,
  total,
  decisions,
  currentUserId,
  page,
  pageCount,
  pending,
  error,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
  onDecide,
}: {
  span: RedactionSpan | undefined
  position: number
  total: number
  decisions: Decisions
  currentUserId: string | undefined
  page: number | null
  pageCount: number | null
  pending: boolean
  error: string | null
  canPrevious: boolean
  canNext: boolean
  onPrevious: () => void
  onNext: () => void
  onDecide: (decision: SpanDecision) => void
}) {
  // A confirmation is not needed: a decision is a recorded, repeatable review
  // action, and the panel shows the result immediately. The refusal is legal
  // state, so the overrides live behind a menu rather than beside the everyday
  // pair.
  const [menuOpen, setMenuOpen] = useState(false)
  if (!span) {
    return (
      <section
        className="border-t border-line bg-surface px-12 py-4 max-compact:px-8"
        aria-label="Decide the selected span"
      >
        <p className="text-meta text-muted">
          {total === 0
            ? 'No spans to decide.'
            : 'No span selected. Choose one in the document or in the list.'}
        </p>
      </section>
    )
  }
  const record = decisions[span.id]
  const state = spanDecisionState(record?.decision)
  const where =
    page === null
      ? null
      : pageCount === null
        ? `Page ${page}`
        : `Page ${page} of ${pageCount}`

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-surface px-12 py-3 max-compact:px-8"
      aria-label="Decide the selected span"
    >
      <div className="flex min-w-0 flex-1 basis-[20rem] items-start gap-3">
        <span className="mt-0.5 text-caption tabular-nums text-subtle">
          {position}
        </span>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="min-w-0 text-item break-words text-ink">
              {span.text}
            </p>
            <span className="text-meta text-muted">
              {categoryLabel[span.category]}
            </span>
            <StatusDot tone={decisionStateTone[state]}>
              {decisionStateLabel[state]}
            </StatusDot>
          </div>
          {record ? (
            <p className="mt-0.5 text-caption text-ink">
              {decisionRecord(record, currentUserId)}
            </p>
          ) : null}
          <p className="mt-0.5 max-w-[68ch] text-caption text-subtle">
            {sourceExplanation[span.source]} · detection confidence:{' '}
            {confidenceLabel[span.confidence].toLowerCase()} ·{' '}
            {confidenceExplanation[span.confidence]}. {CONFIDENCE_CAVEAT}
          </p>
          {where ? (
            <p className="mt-0.5 text-caption text-subtle">{where}</p>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="size-7 px-0"
            aria-label="Previous span"
            disabled={!canPrevious || pending}
            onClick={onPrevious}
            iconStart={<CaretLeft size={14} aria-hidden="true" />}
          />
          <span className="text-caption tabular-nums whitespace-nowrap text-subtle">
            {position} of {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="size-7 px-0"
            aria-label="Next span"
            disabled={!canNext || pending}
            onClick={onNext}
            iconStart={<CaretRight size={14} aria-hidden="true" />}
          />
        </div>
        <div className="flex items-center gap-2">
          <Menu open={menuOpen} onOpenChange={setMenuOpen}>
            <MenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  aria-label="More decisions for this span"
                >
                  <DotsThree size={16} aria-hidden="true" />
                </Button>
              }
            />
            <MenuContent>
              {(
                [
                  ['pseudonymise', 'P'],
                  ['override_redact', null],
                  ['override_keep', null],
                ] as const
              ).map(([decision, shortcut]) => (
                <MenuItem
                  key={decision}
                  onClick={() => {
                    setMenuOpen(false)
                    onDecide(decision)
                  }}
                >
                  <span className="flex-1">
                    {decisionLabel[decision]}
                    <span className="mt-0.5 block text-caption text-subtle">
                      {decisionDescription[decision]}
                    </span>
                  </span>
                  {shortcut ? <KeyboardHint>{shortcut}</KeyboardHint> : null}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => onDecide('reject')}
            iconStart={<X size={12} aria-hidden="true" />}
          >
            Keep visible
            <KeyboardHint className="ml-1">R</KeyboardHint>
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() => onDecide('accept')}
            iconStart={<Check size={12} aria-hidden="true" />}
          >
            Redact
            <KeyboardHint className="ml-1">Enter</KeyboardHint>
          </Button>
        </div>
      </div>
      {error ? (
        <p
          className="flex w-full items-start gap-2 text-meta text-danger"
          role="alert"
        >
          <Warning size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </section>
  )
}
