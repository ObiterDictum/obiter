import type { DocumentReviewToolbar } from './ribbon-types'
import type { ChangeReview } from './use-change-review'

/**
 * The ribbon's tracked-change controls, mapped from the one review derivation
 * the changes panel also reads, so the two surfaces cannot disagree about the
 * active change or what is decidable.
 */
export function changeReviewToolbar(
  review: ChangeReview,
): DocumentReviewToolbar {
  return {
    unavailable: review.unavailable ?? undefined,
    bulkUnavailable: review.bulkUnavailable,
    targetUnavailable: review.targetUnavailable,
    undecidableCount: review.undecidableCount,
    canPrevious: review.canPrevious,
    canNext: review.canNext,
    onPreviousChange: review.goToPrevious,
    onNextChange: review.goToNext,
    onAcceptChange: () => review.decideCurrent('accept'),
    onRejectChange: () => review.decideCurrent('reject'),
    onAcceptAll: () => review.decideAll('accept'),
    onRejectAll: () => review.decideAll('reject'),
  }
}
