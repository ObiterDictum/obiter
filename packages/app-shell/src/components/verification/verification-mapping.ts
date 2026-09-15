import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryKind,
  VerificationFindingView,
} from '@obiter/contracts'
import { paragraphPlainText } from '../../document-model-text'

/**
 * Why a persisted finding cannot be shown beside document text. Every value
 * means "not shown here", never "verified": an unmapped finding stays in the
 * findings index with its reason, and the run outcome is unchanged.
 */
export type UnmappedReason =
  | 'story_not_in_document'
  | 'paragraph_not_in_document'
  | 'range_not_in_document'
  | 'text_changed_since_check'
  | 'range_spans_line_break'
  | 'range_split_across_fragments'
  | 'rendered_anchor_unavailable'
  | 'document_not_mappable'

/**
 * Where a finding belongs in the open document. `mapped` means the recorded
 * location still resolves to the same text in the model being rendered: the
 * paragraph exists, the half-open range fits it, and the text at that range is
 * byte-identical to the excerpt the check recorded. Anything else is `unmapped`
 * with a stated reason, and is never attached to similar-looking text.
 */
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
  // V1-V4 findings predate story coverage, so a location without a part name
  // names its story kind alone. With a part name, only that part may match.
  return partName
    ? stories.filter((story) => story.partName === partName)
    : stories
}

export function paragraphsInStory(
  model: DocumentModelWire,
  kind: DocumentStoryKind | undefined,
  partName: string | undefined,
): DocumentParagraphWire[] {
  const stories = storiesFor(model, kind, partName)
  if (stories.length === 0) return []
  // Prefer the first part that holds the paragraph rather than merging every
  // part: paragraph ids are only unique inside their story, so merging could
  // silently pick another story's paragraph.
  return stories[0]?.paragraphs ?? []
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
  // The excerpt is what the check recorded at this range. A mismatch means the
  // open document's text is not the text that was checked.
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

/**
 * The finding a reviewer should look at next: the first flagged finding, then
 * the first requiring review, then the first finding at all. It is defined once
 * so the dock, the panel and the keyboard shortcut cannot disagree, and it
 * returns the finding's index in the ordered set so "n of N" stays truthful.
 */
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
