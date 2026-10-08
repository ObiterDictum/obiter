import type {
  DocumentComparisonEntry,
  DocumentComparisonSegment,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH,
  DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT,
} from '@obiter/contracts'

/**
 * The per-side token ceiling for a word-level paragraph diff. Above it the
 * paragraph still reports, but the middle collapses to a single
 * removed-then-added pair — honest, just not minimal. This bounds the LCS
 * table at roughly one megabyte per paragraph.
 */
const WORD_DIFF_TOKEN_LIMIT = 500

export interface DocumentModelComparison {
  entries: DocumentComparisonEntry[]
  truncated: boolean
}

interface AlignedPair {
  base?: DocumentParagraphWire
  target?: DocumentParagraphWire
}

/**
 * Compares two immutable document models — the same artifact `/model`
 * serves — into a bounded, ordered entry list. Paragraph pairing is tiered:
 * paragraphs sharing a preserved `w14:paraId` anchor the alignment, leftovers
 * pair on identical text, and the still-unpaired remainder pairs on a
 * high word overlap, so an edit across the canonicalisation boundary — where
 * one version lacks `w14:paraId` entirely — still reports 'modified' rather
 * than a whole-document remove+add. No pairing is ever invented below that
 * bar: anything unmatched is reported as an insertion or deletion.
 *
 * The comparison covers what the wire model carries: story paragraphs and
 * their formatting fingerprints, non-paragraph story structure, styles,
 * numbering, relationships, tracked revisions and imported comments. It does
 * not cover opaque package bytes (media parts, other preserved parts); the
 * route reports a byte-level difference as a note when the model is equal.
 */
export function compareDocumentModels(
  base: DocumentModelWire,
  target: DocumentModelWire,
): DocumentModelComparison {
  const entries: DocumentComparisonEntry[] = []
  let truncated = false
  const push = (entry: DocumentComparisonEntry) => {
    if (entries.length < DOCUMENT_COMPARISON_ENTRY_MAX_COUNT) {
      entries.push(entry)
    } else {
      truncated = true
    }
  }

  // Target-first ordering keeps inserted content in reading order; stories
  // only in the base follow so their removals still land deterministically.
  const partNames = [
    ...new Set(
      [...target.stories, ...base.stories].map((story) => story.partName),
    ),
  ]
  for (const partName of partNames) {
    const baseStory = base.stories.find((story) => story.partName === partName)
    const targetStory = target.stories.find(
      (story) => story.partName === partName,
    )
    for (const pair of alignParagraphs(
      baseStory?.paragraphs ?? [],
      targetStory?.paragraphs ?? [],
    )) {
      if (pair.base === undefined && pair.target !== undefined) {
        push(addedEntry(partName, pair.target))
      } else if (pair.target === undefined && pair.base !== undefined) {
        push(removedEntry(partName, pair.base))
      } else if (pair.base !== undefined && pair.target !== undefined) {
        diffPairedParagraphs(partName, pair.base, pair.target, push)
      }
    }
    // Non-paragraph story content — tables, section properties, bookmarks —
    // lives in the preserved fragments; paragraph diffs cannot see it.
    if (
      baseStory !== undefined &&
      targetStory !== undefined &&
      !arraysEqual(
        baseStory.preservedXmlFragments,
        targetStory.preservedXmlFragments,
      )
    ) {
      push({ type: 'story', storyPartName: partName })
    }
  }

  const areas: ReadonlyArray<{
    area:
      | 'styles'
      | 'numbering'
      | 'relationships'
      | 'comments'
      | 'revisions'
      | 'package'
    before: readonly unknown[]
    after: readonly unknown[]
  }> = [
    { area: 'styles', before: base.styles, after: target.styles },
    { area: 'numbering', before: base.numbering, after: target.numbering },
    {
      area: 'relationships',
      before: base.relationships,
      after: target.relationships,
    },
    { area: 'comments', before: base.comments, after: target.comments },
    { area: 'revisions', before: base.changes, after: target.changes },
    {
      area: 'package',
      before: base.preservedXmlFragments,
      after: target.preservedXmlFragments,
    },
  ]
  for (const { area, before, after } of areas) {
    // These lists are content-addressed: a reorder without content change is
    // not a document difference, so the comparison is order-insensitive.
    if (!sameUnorderedList(before, after)) push({ type: 'package', area })
  }

  return { entries, truncated }
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

function alignParagraphs(
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

  const ordered = [...paired].sort((left, right) => left[0] - right[0])
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

function diffPairedParagraphs(
  partName: string,
  base: DocumentParagraphWire,
  target: DocumentParagraphWire,
  push: (entry: DocumentComparisonEntry) => void,
) {
  const baseText = paragraphText(base)
  const targetText = paragraphText(target)
  if (baseText === targetText) {
    if (
      paragraphFormatFingerprint(base) !== paragraphFormatFingerprint(target)
    ) {
      push({
        type: 'formatted',
        storyPartName: partName,
        paragraphId: target.id,
        ...preview(targetText),
      })
    }
    return
  }
  push({
    type: 'modified',
    storyPartName: partName,
    paragraphId: target.id,
    segments: wordDiff(baseText, targetText),
  })
}

/**
 * What a reader would call this paragraph's formatting: style, paragraph-level
 * preserved markup, and the run property sequence — text and run ids excluded.
 * Runs fold to their property groups first, so a pure run split or merge with
 * identical formatting does not manufacture a diff entry.
 */
function paragraphFormatFingerprint(paragraph: DocumentParagraphWire) {
  const runGroups: string[] = []
  let last = ''
  for (const run of paragraph.runs) {
    const signature = JSON.stringify([
      run.styleId ?? null,
      run.hyperlinkTarget ?? null,
      run.preservedXmlFragments,
    ])
    if (signature !== last) {
      runGroups.push(signature)
      last = signature
    }
  }
  return JSON.stringify([
    paragraph.styleId ?? null,
    paragraph.preservedXmlFragments,
    runGroups,
  ])
}

function paragraphText(paragraph: DocumentParagraphWire) {
  return paragraph.runs.map((run) => run.text).join('')
}

function preview(text: string) {
  return text.length <= DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH
    ? { text, textTruncated: false }
    : {
        text: text.slice(0, DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH),
        textTruncated: true,
      }
}

function addedEntry(partName: string, paragraph: DocumentParagraphWire) {
  return {
    type: 'added' as const,
    storyPartName: partName,
    paragraphId: paragraph.id,
    ...preview(paragraphText(paragraph)),
  }
}

function removedEntry(partName: string, paragraph: DocumentParagraphWire) {
  return {
    type: 'removed' as const,
    storyPartName: partName,
    paragraphId: paragraph.id,
    ...preview(paragraphText(paragraph)),
  }
}

/** Word-level diff of one paragraph pair into same/added/removed segments. */
function wordDiff(baseText: string, targetText: string) {
  const baseTokens = tokenise(baseText)
  const targetTokens = tokenise(targetText)
  let start = 0
  while (
    start < baseTokens.length &&
    start < targetTokens.length &&
    baseTokens[start] === targetTokens[start]
  ) {
    start += 1
  }
  let baseEnd = baseTokens.length
  let targetEnd = targetTokens.length
  while (
    baseEnd > start &&
    targetEnd > start &&
    baseTokens[baseEnd - 1] === targetTokens[targetEnd - 1]
  ) {
    baseEnd -= 1
    targetEnd -= 1
  }

  // The coarse form: verified common head and tail stay 'same', the changed
  // middle reports as one removed block and one added block — honest, just
  // not minimal. It answers both ways the fine-grained diff cannot be
  // served: a middle too large to diff at all, and an LCS result that would
  // fragment past the contract's segment bound.
  const coarse = () => {
    const segments: DocumentComparisonSegment[] = []
    const sameHead = joinTokens(baseTokens.slice(0, start))
    if (sameHead) segments.push({ kind: 'same', text: sameHead })
    const removed = joinTokens(baseTokens.slice(start, baseEnd))
    if (removed) segments.push({ kind: 'removed', text: removed })
    const added = joinTokens(targetTokens.slice(start, targetEnd))
    if (added) segments.push({ kind: 'added', text: added })
    const sameTail = joinTokens(baseTokens.slice(baseEnd))
    if (sameTail) segments.push({ kind: 'same', text: sameTail })
    return segments
  }

  if (
    baseEnd - start > WORD_DIFF_TOKEN_LIMIT ||
    targetEnd - start > WORD_DIFF_TOKEN_LIMIT
  ) {
    return coarse()
  }

  const segments: DocumentComparisonSegment[] = []
  const sameHead = joinTokens(baseTokens.slice(0, start))
  if (sameHead) segments.push({ kind: 'same', text: sameHead })
  for (const segment of lcsDiff(
    baseTokens.slice(start, baseEnd),
    targetTokens.slice(start, targetEnd),
  )) {
    segments.push(segment)
  }
  const sameTail = joinTokens(baseTokens.slice(baseEnd))
  if (sameTail) segments.push({ kind: 'same', text: sameTail })
  const merged = mergeSegments(segments)
  return merged.length <= DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT
    ? merged
    : coarse()
}

/** Runs and whitespace are both tokens, so segments rejoin verbatim. */
function tokenise(text: string) {
  return text.match(/\S+|\s+/g) ?? []
}

function joinTokens(tokens: string[]) {
  return tokens.join('')
}

/** LCS diff over two token lists — quadratic in the (bounded) middle only. */
function lcsDiff(base: string[], target: string[]) {
  const rows = base.length
  const columns = target.length
  const table = new Uint32Array((rows + 1) * (columns + 1))
  const at = (row: number, column: number) => row * (columns + 1) + column
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      table[at(row, column)] =
        base[row] === target[column]
          ? table[at(row + 1, column + 1)] + 1
          : Math.max(table[at(row + 1, column)], table[at(row, column + 1)])
    }
  }
  const segments: DocumentComparisonSegment[] = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (base[row] === target[column]) {
      segments.push({ kind: 'same', text: joinTokens([base[row]]) })
      row += 1
      column += 1
    } else if (table[at(row + 1, column)] >= table[at(row, column + 1)]) {
      segments.push({ kind: 'removed', text: joinTokens([base[row]]) })
      row += 1
    } else {
      segments.push({ kind: 'added', text: joinTokens([target[column]]) })
      column += 1
    }
  }
  while (row < rows) {
    segments.push({ kind: 'removed', text: joinTokens([base[row]]) })
    row += 1
  }
  while (column < columns) {
    segments.push({ kind: 'added', text: joinTokens([target[column]]) })
    column += 1
  }
  return segments
}

function mergeSegments(segments: DocumentComparisonSegment[]) {
  const merged: DocumentComparisonSegment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && last.kind === segment.kind) {
      merged[merged.length - 1] = {
        kind: last.kind,
        text: last.text + segment.text,
      }
    } else {
      merged.push(segment)
    }
  }
  return merged
}

/** Frequencies of the defined `w14:paraId` values — undefined never counts. */
function countDefined(ids: ReadonlyArray<string | undefined>) {
  const counts = new Map<string, number>()
  for (const id of ids) {
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  )
}

/** Order-insensitive multiset equality over JSON-serialised elements. */
function sameUnorderedList(
  left: readonly unknown[],
  right: readonly unknown[],
) {
  if (left.length !== right.length) return false
  const counts = new Map<string, number>()
  for (const item of left) {
    const key = JSON.stringify(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const item of right) {
    const key = JSON.stringify(item)
    const count = counts.get(key)
    if (!count) return false
    counts.set(key, count - 1)
  }
  return true
}
