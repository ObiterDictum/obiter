import type { DocumentParagraphWire } from '@obiter/contracts'
import { tokenise } from './document-compare-word-diff'

export interface AlignedPair {
  base?: DocumentParagraphWire
  target?: DocumentParagraphWire
}

const SIMILARITY_GAP_PRODUCT_LIMIT = 4096
const SIMILARITY_OVERLAP_MIN = 0.6
const SIMILARITY_COMMON_MIN = 3

export function alignParagraphs(
  base: DocumentParagraphWire[],
  target: DocumentParagraphWire[],
): AlignedPair[] {
  if (base.length === 0)
    return target.map((paragraph) => ({ target: paragraph }))
  if (target.length === 0) return base.map((paragraph) => ({ base: paragraph }))

  const baseIds = base.map((paragraph) => paragraph.sourceParaId)
  const targetIds = target.map((paragraph) => paragraph.sourceParaId)
  const baseCounts = countDefined(baseIds)
  const targetCounts = countDefined(targetIds)

  const uniqueTarget = new Map<string, number>()
  targetIds.forEach((id, index) => {
    if (id !== undefined && targetCounts.get(id) === 1) {
      uniqueTarget.set(id, index)
    }
  })
  const candidates: Array<[number, number]> = []
  baseIds.forEach((id, index) => {
    if (id === undefined || baseCounts.get(id) !== 1) return
    const targetIndex = uniqueTarget.get(id)
    if (targetIndex !== undefined) candidates.push([index, targetIndex])
  })

  const anchors = longestIncreasingPairs(candidates)
  const paired = new Set(anchors)

  let previousBase = -1
  let previousTarget = -1
  for (const [baseIndex, targetIndex] of anchors) {
    pairGap(
      base,
      target,
      previousBase + 1,
      baseIndex,
      previousTarget + 1,
      targetIndex,
      paired,
    )
    previousBase = baseIndex
    previousTarget = targetIndex
  }
  pairGap(
    base,
    target,
    previousBase + 1,
    base.length,
    previousTarget + 1,
    target.length,
    paired,
  )

  const ordered = longestIncreasingPairs(
    [...paired].sort((left, right) => left[0] - right[0]),
  )
  const pairs: AlignedPair[] = []
  let baseCursor = 0
  let targetCursor = 0
  for (const [baseIndex, targetIndex] of ordered) {
    while (baseCursor < baseIndex) {
      pairs.push({ base: base[baseCursor] })
      baseCursor += 1
    }
    while (targetCursor < targetIndex) {
      pairs.push({ target: target[targetCursor] })
      targetCursor += 1
    }
    pairs.push({ base: base[baseIndex], target: target[targetIndex] })
    baseCursor = baseIndex + 1
    targetCursor = targetIndex + 1
  }
  while (baseCursor < base.length) {
    pairs.push({ base: base[baseCursor] })
    baseCursor += 1
  }
  while (targetCursor < target.length) {
    pairs.push({ target: target[targetCursor] })
    targetCursor += 1
  }
  return pairs
}

function pairGap(
  base: DocumentParagraphWire[],
  target: DocumentParagraphWire[],
  baseStart: number,
  baseEnd: number,
  targetStart: number,
  targetEnd: number,
  paired: Set<[number, number]>,
) {
  const targetByText = new Map<string, number[]>()
  for (let index = targetStart; index < targetEnd; index += 1) {
    const text = paragraphText(target[index])
    const queue = targetByText.get(text)
    if (queue) queue.push(index)
    else targetByText.set(text, [index])
  }
  const usedTargets = new Set<number>()
  const leftoverBase: number[] = []

  for (let index = baseStart; index < baseEnd; index += 1) {
    const queue = targetByText.get(paragraphText(base[index]))
    const targetIndex = queue?.shift()
    if (targetIndex === undefined) {
      leftoverBase.push(index)
      continue
    }
    usedTargets.add(targetIndex)
    paired.add([index, targetIndex])
  }

  const leftoverTarget: number[] = []
  for (let index = targetStart; index < targetEnd; index += 1) {
    if (!usedTargets.has(index)) leftoverTarget.push(index)
  }
  if (
    leftoverBase.length === 0 ||
    leftoverTarget.length === 0 ||
    leftoverBase.length * leftoverTarget.length > SIMILARITY_GAP_PRODUCT_LIMIT
  ) {
    return
  }

  const baseTokens = leftoverBase.map((index) => wordCounts(base[index]))
  const targetTokens = leftoverTarget.map((index) => wordCounts(target[index]))
  const candidates: Array<{ score: number; base: number; target: number }> = []
  leftoverBase.forEach((baseIndex, i) => {
    leftoverTarget.forEach((targetIndex, j) => {
      const common = commonWordCount(baseTokens[i], targetTokens[j])
      if (
        common >= SIMILARITY_COMMON_MIN &&
        common / Math.min(baseTokens[i].size, targetTokens[j].size) >=
          SIMILARITY_OVERLAP_MIN
      ) {
        candidates.push({
          score: common / Math.min(baseTokens[i].size, targetTokens[j].size),
          base: baseIndex,
          target: targetIndex,
        })
      }
    })
  })
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.base - right.base ||
      left.target - right.target,
  )
  const usedBase = new Set<number>()
  for (const candidate of candidates) {
    if (usedBase.has(candidate.base) || usedTargets.has(candidate.target)) {
      continue
    }
    usedBase.add(candidate.base)
    usedTargets.add(candidate.target)
    paired.add([candidate.base, candidate.target])
  }
}

function wordCounts(paragraph: DocumentParagraphWire) {
  const counts = new Map<string, number>()
  for (const token of tokenise(paragraphText(paragraph))) {
    if (/^\s+$/u.test(token)) continue
    counts.set(token, (counts.get(token) ?? 0) + 1)
  }
  return counts
}

function commonWordCount(
  left: Map<string, number>,
  right: Map<string, number>,
) {
  let common = 0
  for (const [word, count] of left) {
    common += Math.min(count, right.get(word) ?? 0)
  }
  return common
}

function longestIncreasingPairs(candidates: Array<[number, number]>) {
  const parent = Array.from({ length: candidates.length }, () => -1)
  const chains: number[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const targetIndex = candidates[index][1]
    let low = 0
    let high = chains.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (candidates[chains[middle]][1] < targetIndex) low = middle + 1
      else high = middle
    }
    if (low > 0) parent[index] = chains[low - 1]
    if (low === chains.length) chains.push(index)
    else chains[low] = index
  }
  const anchors: Array<[number, number]> = []
  let current = chains[chains.length - 1]
  while (current !== undefined && current !== -1) {
    anchors.push(candidates[current])
    current = parent[current]
  }
  return anchors.reverse()
}

function paragraphText(paragraph: DocumentParagraphWire) {
  return paragraph.runs.map((run) => run.text).join('')
}

function countDefined(ids: ReadonlyArray<string | undefined>) {
  const counts = new Map<string, number>()
  for (const id of ids) {
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
