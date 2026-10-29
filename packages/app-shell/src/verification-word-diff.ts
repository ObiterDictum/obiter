export type DiffWord = { text: string; changed: boolean }

function tokens(text: string) {
  return (
    text.match(
      /[\p{L}\p{M}\p{N}]+(?:[’'][\p{L}\p{M}\p{N}]+)*|[^\p{L}\p{M}\p{N}]+/gu,
    ) ?? []
  )
}

export function verificationWordDiff(draft: string, source: string) {
  const left = tokens(draft)
  const right = tokens(source)
  const words = (items: string[]) =>
    items.flatMap((text, index) =>
      /^[\p{L}\p{M}\p{N}]/u.test(text)
        ? [{ text: text.toLowerCase().replaceAll('’', "'"), index }]
        : [],
    )
  const a = words(left)
  const b = words(right)
  if ((a.length + 1) * (b.length + 1) > 2_000_000) return null
  const width = b.length + 1
  const costs = new Uint32Array((a.length + 1) * width)
  for (let i = 1; i <= a.length; i++) {
    costs[i * width] = i
    for (let j = 1; j <= b.length; j++) {
      costs[i * width + j] = Math.min(
        (costs[(i - 1) * width + j - 1] ?? 0) +
          (a[i - 1]?.text === b[j - 1]?.text ? 0 : 1),
        (costs[(i - 1) * width + j] ?? 0) + 1,
        (costs[i * width + j - 1] ?? 0) + 1,
      )
    }
  }
  let i = a.length
  let j = 0
  for (let end = 1; end <= b.length; end++) {
    if ((costs[i * width + end] ?? 0) <= (costs[i * width + j] ?? 0)) j = end
  }
  const changedLeft = new Set<number>()
  const changedRight = new Set<number>()
  while (i > 0) {
    const l = a[i - 1]
    const r = b[j - 1]
    const cost = costs[i * width + j]
    if (
      j > 0 &&
      cost ===
        (costs[(i - 1) * width + j - 1] ?? 0) + (l?.text === r?.text ? 0 : 1)
    ) {
      if (l && r && l.text !== r.text) {
        changedLeft.add(l.index)
        changedRight.add(r.index)
      }
      i--
      j--
    } else if (j > 0 && cost === (costs[i * width + j - 1] ?? 0) + 1) {
      if (r) changedRight.add(r.index)
      j--
    } else {
      if (l) changedLeft.add(l.index)
      i--
    }
  }
  const mark = (items: string[], changed: Set<number>): DiffWord[] =>
    items.map((text, index) => ({ text, changed: changed.has(index) }))
  return { draft: mark(left, changedLeft), source: mark(right, changedRight) }
}
