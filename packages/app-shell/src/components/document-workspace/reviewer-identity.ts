import { initialsOf } from '../../format'
import { PAPER_REVIEWER_MARKS } from './tracked-marks'

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

export type ReviewerStyle = {
  text: string
  surface: string
  paperText: string
  initials: string
  slot: number
}

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
