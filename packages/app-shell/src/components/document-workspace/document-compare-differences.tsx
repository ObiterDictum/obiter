import type { ReactNode } from 'react'
import { DockedPanel, cn } from '@obiter/ui'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  type DocumentComparisonEntry,
  type DocumentComparisonSegment,
  type DocumentCompareResponse,
} from '@obiter/contracts'
import { TRACKED_DELETE_MARK, TRACKED_INSERT_MARK } from './tracked-marks'

/**
 * The difference list beside the redline: one row per difference in document
 * order, naming where it is and showing what it says. A row is a column of two
 * blocks rather than a control with a fixed height, so a long paragraph wraps
 * inside its own row instead of overflowing onto the next one.
 */
export function CompareDifferencesPanel({
  data,
  active,
  onJump,
  onClose,
}: {
  data: DocumentCompareResponse
  active: number
  onJump: (index: number) => void
  onClose: () => void
}) {
  return (
    <DockedPanel title="Differences" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-caption text-muted">
          {data.entries.length === 0
            ? 'No differences.'
            : `${String(data.entries.length)} difference${data.entries.length === 1 ? '' : 's'}, in document order.`}
        </p>
        <ul className="flex flex-col">
          {data.entries.map((entry, index) => (
            <li key={index} className="border-t border-line first:border-t-0">
              <button
                type="button"
                className={cn(
                  'flex w-full min-w-0 flex-col gap-0.5 rounded-sm py-2 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  index === active && 'bg-hover',
                )}
                aria-label={`Show difference ${String(index + 1)}: ${entryLabel(entry)}`}
                aria-current={index === active ? 'true' : undefined}
                onClick={() => onJump(index)}
              >
                <span className="text-caption text-subtle">
                  {entryLabel(entry)}
                </span>
                <span className="text-body break-words text-ink">
                  {entryPreview(entry)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {data.entriesTruncated ? (
          <p className="text-caption text-muted" role="status">
            Only the first {DOCUMENT_COMPARISON_ENTRY_MAX_COUNT} differences are
            shown.
          </p>
        ) : null}
        {data.notes.map((note, index) => (
          <p key={index} className="text-caption text-muted">
            {note}
          </p>
        ))}
      </div>
    </DockedPanel>
  )
}

/**
 * The segments of a wording change, marked in place: what is gone struck
 * through, what replaced it underlined, so a reader sees the sentence as it
 * now reads and the words it lost in the same line. The paper is a fixed white
 * sheet and the panel is themed chrome, so each surface paints its own marks.
 */
export function comparisonSegments(
  segments: readonly DocumentComparisonSegment[],
  surface: 'paper' | 'panel',
): ReactNode {
  const removed = surface === 'paper' ? TRACKED_DELETE_MARK : 'text-danger'
  const added = surface === 'paper' ? TRACKED_INSERT_MARK : 'text-success'
  return segments.map((segment, index) =>
    segment.kind === 'same' ? (
      segment.text
    ) : segment.kind === 'removed' ? (
      <del key={index} className={cn(removed, 'line-through')}>
        {segment.text}
      </del>
    ) : (
      <ins key={index} className={cn(added, 'underline')}>
        {segment.text}
      </ins>
    ),
  )
}

export function entryLabel(entry: DocumentComparisonEntry) {
  switch (entry.type) {
    case 'added':
      return 'Paragraph added'
    case 'removed':
      return 'Paragraph removed'
    case 'modified':
      return 'Wording changed'
    case 'formatted':
      return 'Formatting changed'
    case 'story':
      return 'Structure changed'
    case 'package':
      return packageAreaLabel(entry.area)
  }
}

function entryPreview(entry: DocumentComparisonEntry): ReactNode {
  if (entry.type === 'story' || entry.type === 'package') return ''
  if (entry.type === 'modified')
    return comparisonSegments(entry.segments, 'panel')
  return entry.text
}

function packageAreaLabel(area: string) {
  switch (area) {
    case 'styles':
      return 'Styles changed'
    case 'numbering':
      return 'List numbering changed'
    case 'relationships':
      return 'Document links changed'
    case 'comments':
      return 'Comment records changed'
    case 'revisions':
      return 'Tracked changes differ'
    default:
      return 'Document package changed'
  }
}
