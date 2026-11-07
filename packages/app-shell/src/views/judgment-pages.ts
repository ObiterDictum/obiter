import type { JudgmentPage } from '@obiter/contracts'

export type PlacedPage = JudgmentPage & { at: number }

export function judgmentTarget(value: string) {
  const match = /^(p\.\s*)?([1-9]\d*)$/.exec(value.trim())
  return match ? `${match[1] ? 'page' : 'para'}-${match[2]}` : null
}

export function placePages(
  pages: JudgmentPage[] | undefined,
  paragraphs: { id: string; paragraphNumber: number }[],
): PlacedPage[] | undefined {
  if (!pages) return undefined
  const byId = new Map(paragraphs.map((p, index) => [p.id, index]))
  const firstByNumber = new Map<number, number>()
  paragraphs.forEach((p, index) => {
    if (!firstByNumber.has(p.paragraphNumber))
      firstByNumber.set(p.paragraphNumber, index)
  })
  return pages.flatMap((page) => {
    const at =
      page.paragraphId === undefined
        ? firstByNumber.get(page.paragraphNumber)
        : byId.get(page.paragraphId)
    return at === undefined ? [] : [{ ...page, at }]
  })
}

export function pageAtPosition(
  pages: PlacedPage[] | undefined,
  at: number,
  offset = 0,
) {
  let index = -1
  pages?.forEach((p, candidate) => {
    if (p.at < at || (p.at === at && p.offset <= offset)) index = candidate
  })
  const current = pages?.[index]
  const next = pages?.[index + 1]
  if (
    !current ||
    ((!next || next.page !== current.page + 1) &&
      (at !== current.at || offset !== current.offset))
  )
    return undefined
  return current.page
}
