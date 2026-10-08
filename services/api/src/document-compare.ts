import type {
  DocumentComparisonEntry,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH,
} from '@obiter/contracts'
import { alignParagraphs, paragraphText } from './document-compare-align'
import { wordDiff } from './document-compare-word-diff'

export interface DocumentModelComparison {
  entries: DocumentComparisonEntry[]
  truncated: boolean
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
  // The entry list is capped by contract. Entries are built lazily: once the
  // bound is hit a push only records truncation, so a pair past the cap costs
  // a text compare — never a bounded-LCS word diff nobody will read.
  const push = (build: () => DocumentComparisonEntry) => {
    if (entries.length < DOCUMENT_COMPARISON_ENTRY_MAX_COUNT) {
      entries.push(build())
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
    if (truncated) break
    const baseStory = base.stories.find((story) => story.partName === partName)
    const targetStory = target.stories.find(
      (story) => story.partName === partName,
    )
    for (const { base: pairBase, target: pairTarget } of alignParagraphs(
      baseStory?.paragraphs ?? [],
      targetStory?.paragraphs ?? [],
    )) {
      if (truncated) break
      if (pairBase === undefined && pairTarget !== undefined) {
        push(() => addedEntry(partName, pairTarget))
      } else if (pairTarget === undefined && pairBase !== undefined) {
        push(() => removedEntry(partName, pairBase))
      } else if (pairBase !== undefined && pairTarget !== undefined) {
        diffPairedParagraphs(partName, pairBase, pairTarget, push)
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
      push(() => ({ type: 'story', storyPartName: partName }))
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
    if (truncated) break
    // These lists are content-addressed: a reorder without content change is
    // not a document difference, so the comparison is order-insensitive.
    if (!sameUnorderedList(before, after)) {
      push(() => ({ type: 'package', area }))
    }
  }

  return { entries, truncated }
}

function diffPairedParagraphs(
  partName: string,
  base: DocumentParagraphWire,
  target: DocumentParagraphWire,
  push: (build: () => DocumentComparisonEntry) => void,
) {
  const baseText = paragraphText(base)
  const targetText = paragraphText(target)
  if (baseText === targetText) {
    if (
      paragraphFormatFingerprint(base) !== paragraphFormatFingerprint(target)
    ) {
      push(() => ({
        type: 'formatted',
        storyPartName: partName,
        paragraphId: target.id,
        ...preview(targetText),
      }))
    }
    return
  }
  push(() => ({
    type: 'modified',
    storyPartName: partName,
    paragraphId: target.id,
    segments: wordDiff(baseText, targetText),
  }))
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
