import type { DocumentTextRunWire } from '@obiter/contracts'

/** Controls at a cut precede the reopened text element, so belong to the head. */
export function sliceRunRevisionMetadata(
  run: DocumentTextRunWire,
  from: number,
  to: number,
) {
  if (run.textRevisionEligible) return { textRevisionEligible: true }
  let cursor = 0
  const tokens: NonNullable<DocumentTextRunWire['textRevisionTokens']> = []
  for (const token of run.textRevisionTokens ?? []) {
    if (token.kind === 'retained') {
      if ((cursor > from || from === 0) && cursor <= to) tokens.push(token)
      continue
    }
    const end = cursor + token.text.length
    if (end > from && cursor < to)
      tokens.push({
        ...token,
        text: token.text.slice(Math.max(0, from - cursor), to - cursor),
      })
    cursor = end
  }
  return { textRevisionEligible: false, textRevisionTokens: tokens }
}
