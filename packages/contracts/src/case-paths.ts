export function createCanonicalCasePath(input: {
  id: string
  title: string
  neutralCitation: string | null
}) {
  const documentIdSlug = slugifyCaseText(input.id)
  const citationSlug = input.neutralCitation
    ? slugifyCaseCitation(input.neutralCitation)
    : ''
  const titleSlug = slugifyCaseText(input.title)
  const slug = input.id.startsWith('d-')
    ? [documentIdSlug, titleSlug, citationSlug].filter(Boolean).join('-')
    : citationSlug
      ? [titleSlug, citationSlug].filter(Boolean).join('-')
      : documentIdSlug

  return `/case/${slug}`
}

export function resolveCaseDocumentIdFromSlug(caseSlug: string) {
  const normalizedSlug = slugifyCaseText(caseSlug)
  const stableDocumentId = normalizedSlug
    .match(
      /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-|$)/,
    )?.[0]
    ?.replace(/-$/, '')
  if (stableDocumentId) return stableDocumentId

  const parts = normalizedSlug.split('-').filter(Boolean)
  const citationStart = findCitationSlugStart(parts)

  if (citationStart === -1) return normalizedSlug

  const citationParts = parts.slice(citationStart)
  const year = citationParts[0]
  const numberIndex = citationParts.findIndex(
    (part, index) => index > 1 && /^\d+$/.test(part),
  )
  if (!year || numberIndex === -1) return normalizedSlug

  const number = citationParts[numberIndex]
  const courtParts = [
    ...citationParts.slice(1, numberIndex),
    ...citationParts.slice(numberIndex + 1),
  ]

  return `${courtParts.join('-')}-${year}-${number}`
}

function findCitationSlugStart(parts: string[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (
      /^\d{4}$/.test(parts[index] ?? '') &&
      parts.slice(index + 2).some((part) => /^\d+$/.test(part))
    ) {
      return index
    }
  }

  return -1
}

function slugifyCaseCitation(value: string) {
  return slugifyCaseText(value.replace(/[[\]()]/g, ' '))
}

function slugifyCaseText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
