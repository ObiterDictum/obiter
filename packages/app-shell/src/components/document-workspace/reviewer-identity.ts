import { initialsOf } from '../../format'
import { PAPER_REVIEWER_MARKS } from './tracked-marks'

/**
 * Who made a tracked change, as something a reader can see: a stable hue from
 * a six-colour palette and the author's initials. Colour alone is not the
 * signal — the initials are printed beside it — but the hue lets a reader
 * follow one reviewer through a long document at a glance.
 */
const CLASSES = [
  {
    text: 'text-reviewer-1',
    surface: 'bg-reviewer-1-surface',
    paperText: PAPER_REVIEWER_MARKS[0],
  },
  {
    text: 'text-reviewer-2',
    surface: 'bg-reviewer-2-surface',
    paperText: PAPER_REVIEWER_MARKS[1],
  },
  {
    text: 'text-reviewer-3',
    surface: 'bg-reviewer-3-surface',
    paperText: PAPER_REVIEWER_MARKS[2],
  },
  {
    text: 'text-reviewer-4',
    surface: 'bg-reviewer-4-surface',
    paperText: PAPER_REVIEWER_MARKS[3],
  },
  {
    text: 'text-reviewer-5',
    surface: 'bg-reviewer-5-surface',
    paperText: PAPER_REVIEWER_MARKS[4],
  },
  {
    text: 'text-reviewer-6',
    surface: 'bg-reviewer-6-surface',
    paperText: PAPER_REVIEWER_MARKS[5],
  },
] as const

/** The class names carry the hue; they must stay literal for Tailwind. */
export type ReviewerStyle = {
  text: string
  surface: string
  /** The same hue, held dark enough for the fixed white sheet in both themes. */
  paperText: string
  initials: string
  /** Index 1-6, for a `data-reviewer` attribute in tests and styling. */
  slot: number
}

/** FNV-1a over the author name: stable across sessions and documents. */
function hash(value: string) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return result >>> 0
}

function reviewerInitials(author: string | undefined) {
  const trimmed = (author ?? '').trim()
  return trimmed === '' ? '?' : initialsOf(trimmed)
}

export function reviewerStyle(author: string | undefined): ReviewerStyle {
  const slot = (hash((author ?? 'unknown').trim().toLowerCase()) % 6) + 1
  const classes = CLASSES[slot - 1] ?? CLASSES[0]!
  return {
    text: classes.text,
    surface: classes.surface,
    paperText: classes.paperText,
    initials: reviewerInitials(author),
    slot,
  }
}
