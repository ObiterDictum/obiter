import type { JudgmentPage } from '@obiter/contracts'

export function judgmentTarget(value: string) {
  const match = /^(p\.\s*)?([1-9]\d*)$/.exec(value.trim())
  return match ? `${match[1] ? 'page' : 'para'}-${match[2]}` : null
}

export function pageAtPosition(
  pages: JudgmentPage[] | undefined,
  paragraph: number,
  offset = 0,
) {
  let index = -1
  pages?.forEach((p, candidate) => {
    if (
      p.paragraphNumber < paragraph ||
      (p.paragraphNumber === paragraph && p.offset <= offset)
    )
      index = candidate
  })
  const current = pages?.[index]
  const next = pages?.[index + 1]
  if (
    !current ||
    ((!next || next.page !== current.page + 1) &&
      (paragraph !== current.paragraphNumber || offset !== current.offset))
  )
    return undefined
  return current.page
}
