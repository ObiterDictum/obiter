/**
 * Who made a tracked change, as something a reader can see: a stable hue from
 * a six-colour palette and the author's initials. Colour alone is not the
 * signal — the initials are printed beside it — but the hue lets a reader
 * follow one reviewer through a long document at a glance.
 */
const CLASSES = [
  { text: 'text-reviewer-1', surface: 'bg-reviewer-1-surface' },
  { text: 'text-reviewer-2', surface: 'bg-reviewer-2-surface' },
  { text: 'text-reviewer-3', surface: 'bg-reviewer-3-surface' },
  { text: 'text-reviewer-4', surface: 'bg-reviewer-4-surface' },
  { text: 'text-reviewer-5', surface: 'bg-reviewer-5-surface' },
  { text: 'text-reviewer-6', surface: 'bg-reviewer-6-surface' },
] as const

/** The class names carry the hue; they must stay literal for Tailwind. */
export type ReviewerStyle = {
  text: string
  surface: string
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

export function reviewerInitials(author: string | undefined) {
  const words = (author ?? '')
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase()
  return `${words[0]![0] ?? ''}${words[words.length - 1]![0] ?? ''}`.toUpperCase()
}

export function reviewerStyle(author: string | undefined): ReviewerStyle {
  const slot = (hash((author ?? 'unknown').trim().toLowerCase()) % 6) + 1
  const classes = CLASSES[slot - 1] ?? CLASSES[0]!
  return {
    text: classes.text,
    surface: classes.surface,
    initials: reviewerInitials(author),
    slot,
  }
}
