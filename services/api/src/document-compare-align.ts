import type { DocumentParagraphWire } from '@obiter/contracts'
import { tokenise } from './document-compare-word-diff'

export interface AlignedPair {
  base?: DocumentParagraphWire
  target?: DocumentParagraphWire
}

/* Paragraph alignment
 *
 * Anchored matching, not a positional zip. `w14:paraId` is durable paragraph
 * identity across saves: ids unique on both sides form candidate pairs and
 * the longest monotonic subsequence anchors the walk, so a moved paragraph
 * reports as remove+add instead of corrupting every neighbour's alignment.
 * Within each gap, leftovers pair on identical text — an unchanged paragraph
 * must not report a difference just because one version predates `w14`
 * canonicalisation — and the remaining unpaired paragraphs pair on word
 * overlap, which is what turns an in-place edit of an unidentitied
 * paragraph into a 'modified' entry instead of a remove+add pair. Anything
 * still unmatched is an insertion or deletion: the diff can over-report a
 * split but never silently hide one.
 *
 * The gap passes do not keep the pair set monotonic: identical text pairs
 * in occurrence order per text (which inverts across texts on a reorder)
 * and overlap pairs in score order. A final increasing-subsequence pass
 * over the union restores the emission walk's precondition; pairs it drops
 * degrade to unmatched, so an inversion reports remove+add, the same move
 * semantics as an anchor-excluded id pair, rather than double-claiming a
 * paragraph as added and paired at once.
 */

/**
 * Word-overlap pairing applies only inside small gaps: a large unmatched
 * region is a wholesale insertion or deletion, where fuzzy pairing would
 * manufacture 'modified' noise. The product bound also keeps the O(n²)
 * token-overlap comparisons cheap.
 */
const SIMILARITY_GAP_PRODUCT_LIMIT = 4096
/** A pairing needs most of the shorter paragraph's words to survive. */
const SIMILARITY_OVERLAP_MIN = 0.6
/** And enough shared words that 'and'/'the' fragments cannot qualify. */
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

  // Gap passes pair what anchors leave unmatched: identical text first, then
  // high word overlap for the remainder.
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

  // Anchors are mutually monotonic and gap pairs sit between anchor
  // boundaries, so only same-gap pairs can cross. When they do, the walk
  // below would emit a paired-later target as 'added' while its removal
  // half vanished. Dropped pairs keep both sides unmatched, which is why
  // the losers report instead of disappearing.
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

/**
 * Pairs the unmatched paragraphs between two anchors. Identical text pairs
 * first — occurrences in order, so duplicated paragraphs (empty spacers are
 * the common case) pair k-th with k-th and only the genuine count difference
 * reports. A paragraph unchanged except for gaining a `w14:paraId` on save is
 * still the same content. The leftovers then pair on word overlap so a
 * cross-canonicalisation edit reads as 'modified'; below the overlap bar the
 * diff reports an honest delete+insert.
 */
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

  // Deterministic greedy pairing: best overlap first, ties by base then
  // target order. Two paragraphs pair only when at least 60% of the shorter
  // one's words survive — below that a 'modified' entry would misrepresent
  // what is really an unrelated delete+insert.
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

/**
 * Multiset of the paragraph's word tokens — whitespace excluded, so a pure
 * spacing change cannot inflate or deflate the overlap score.
 */
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

/**
 * Longest subsequence of `[base, target]` candidates with strictly rising
 * target index — patience sorting with parent links. Candidates arrive in
 * base order, so the result is the largest order-preserving match set.
 */
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

export function paragraphText(paragraph: DocumentParagraphWire) {
  return paragraph.runs.map((run) => run.text).join('')
}

/** Frequencies of the defined `w14:paraId` values — undefined never counts. */
function countDefined(ids: ReadonlyArray<string | undefined>) {
  const counts = new Map<string, number>()
  for (const id of ids) {
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
