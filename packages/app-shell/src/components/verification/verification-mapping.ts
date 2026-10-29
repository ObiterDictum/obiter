import type {
  DocumentModelWire,
  DocumentStoryKind,
  VerificationFindingView,
} from '@obiter/contracts'
import { paragraphPlainText } from '../../document-model-text'

export type UnmappedReason =
  | 'story_not_in_document'
  | 'paragraph_not_in_document'
  | 'range_not_in_document'
  | 'text_changed_since_check'
  | 'range_spans_line_break'
  | 'range_split_across_fragments'
  | 'rendered_anchor_unavailable'
  | 'document_not_mappable'

export type FindingTarget =
  | {
      kind: 'mapped'
      paragraphId: string
      storyKind: DocumentStoryKind
      storyPartName: string
      start: number
      end: number
    }
  | { kind: 'unmapped'; reason: UnmappedReason }

function storiesFor(
  model: DocumentModelWire,
  kind: DocumentStoryKind | undefined,
  partName: string | undefined,
) {
  const stories = model.stories.filter((story) => story.kind === kind)
  return partName
    ? stories.filter((story) => story.partName === partName)
    : stories
}

export function resolveFindingTarget(
  finding: VerificationFindingView,
  model: DocumentModelWire,
): FindingTarget {
  const { location } = finding
  const stories = storiesFor(model, location.storyKind, location.storyPartName)
  if (stories.length === 0)
    return { kind: 'unmapped', reason: 'story_not_in_document' }
  const stored = stories[0]?.paragraphs.find(
    (paragraph) => paragraph.id === location.paragraphId,
  )
  if (!stored) {
    return { kind: 'unmapped', reason: 'paragraph_not_in_document' }
  }
  const text = paragraphPlainText(stored)
  if (location.end > text.length || location.start >= location.end) {
    return { kind: 'unmapped', reason: 'range_not_in_document' }
  }
  if (text.slice(location.start, location.end) !== finding.excerpt) {
    return { kind: 'unmapped', reason: 'text_changed_since_check' }
  }
  return {
    kind: 'mapped',
    paragraphId: location.paragraphId,
    storyKind: location.storyKind ?? 'document',
    storyPartName: location.storyPartName ?? stories[0]?.partName ?? '',
    start: location.start,
    end: location.end,
  }
}

export function nextActionableIndex(
  findings: VerificationFindingView[],
): number {
  const rank = (finding: VerificationFindingView) => {
    if (finding.state === 'flagged') return 0
    if (finding.state === 'review_required') return 1
    if (finding.state === 'not_checked') return 2
    return 3
  }
  let best = -1
  for (const [index, finding] of findings.entries()) {
    if (best === -1 || rank(finding) < rank(findings[best]!)) best = index
  }
  return best
}
