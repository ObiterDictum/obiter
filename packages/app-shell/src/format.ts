/**
 * The two letters a person is shown by: first name and last name, or the first
 * letter of a single-word name. Only letters count — an organisation in
 * brackets ("Brightwater (Legal)") still yields two letters, not "B(".
 */
export function initialsOf(name: string) {
  const words = name
    .split(/\s+/)
    .map((word) => lettersOnly(word))
    .filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return `${first}${last}`.toUpperCase()
}

function lettersOnly(word: string) {
  return [...word].filter((char) => /\p{L}/u.test(char)).join('')
}

/** One date style across the product: 24 Oct 2026. */
export function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** One absolute time style: 24 Oct 2026, 14:32. */
export function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

/** File sizes in the product's one style: 37.8 KB, 1.2 MB. */
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

/**
 * How long ago, in the product's one style: "just now", "24 minutes ago",
 * "yesterday", then the date. Approximate on purpose — "where you left off"
 * needs to place the document in your day, not to time it to the second.
 */
export function formatRelativeTime(value: string, now: Date = new Date()) {
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return value
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60)
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return formatDate(value)
}
