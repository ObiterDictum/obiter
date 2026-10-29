import type {
  DocumentComparisonEntry,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  DOCUMENT_COMPARISON_ENTRY_MAX_COUNT,
  DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH,
} from '@obiter/contracts'
import { alignParagraphs } from './document-compare-align'
import { wordDiff } from './document-compare-word-diff'

export interface DocumentModelComparison {
  entries: DocumentComparisonEntry[]
  truncated: boolean
}

export function compareDocumentModels(
  base: DocumentModelWire,
  target: DocumentModelWire,
): DocumentModelComparison {
  const entries: DocumentComparisonEntry[] = []
  const baseText = versionReader(base)
  const targetText = versionReader(target)
  let truncated = false
  const push = (build: () => DocumentComparisonEntry) => {
    if (entries.length < DOCUMENT_COMPARISON_ENTRY_MAX_COUNT) {
      entries.push(build())
    } else {
      truncated = true
    }
  }

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
        push(() => addedEntry(partName, pairTarget, targetText))
      } else if (pairTarget === undefined && pairBase !== undefined) {
        push(() => removedEntry(partName, pairBase, baseText))
      } else if (pairBase !== undefined && pairTarget !== undefined) {
        diffPairedParagraphs(
          partName,
          pairBase,
          pairTarget,
          { base: baseText, target: targetText },
          push,
        )
      }
    }
    if (baseStory !== undefined && targetStory !== undefined) {
      if (
        !arraysEqual(
          baseStory.preservedXmlFragments,
          targetStory.preservedXmlFragments,
        )
      ) {
        push(() => ({ type: 'story', storyPartName: partName }))
      }
    } else {
      const present = baseStory ?? targetStory
      if (
        present !== undefined &&
        (present.paragraphs.length === 0 ||
          present.preservedXmlFragments.length > 0)
      ) {
        push(() => ({ type: 'story', storyPartName: partName }))
      }
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
    if (!sameUnorderedList(before, after)) {
      push(() => ({ type: 'package', area }))
    }
  }

  return { entries, truncated }
}

type ParagraphReader = (paragraph: DocumentParagraphWire) => string

function versionReader(model: DocumentModelWire): ParagraphReader {
  const inserts = new Map<
    string,
    Array<{ beforeRunId: string | null; text: string }>
  >()
  for (const change of model.changes) {
    const paragraphId = change.paragraphId
    const inserted =
      change.kind === 'insert' ||
      (change.kind === 'move' && change.direction === 'to')
    if (paragraphId === undefined || !inserted) continue
    const segments = change.inlinePosition?.segments ?? []
    const text = segments
      .filter((segment) => !segment.deleted)
      .map((segment) => segment.text)
      .join('')
    const list = inserts.get(paragraphId) ?? []
    list.push({
      beforeRunId: change.inlinePosition?.beforeRunId ?? null,
      text: text === '' ? change.text : text,
    })
    inserts.set(paragraphId, list)
  }
  return (paragraph) => {
    const list = inserts.get(paragraph.id) ?? []
    const before = (runId: string | null) =>
      list
        .filter((insert) => insert.beforeRunId === runId)
        .map((insert) => insert.text)
        .join('')
    return paragraph.runs
      .map((run) => before(run.id) + run.text)
      .concat(before(null))
      .join('')
  }
}

function diffPairedParagraphs(
  partName: string,
  base: DocumentParagraphWire,
  target: DocumentParagraphWire,
  read: { base: ParagraphReader; target: ParagraphReader },
  push: (build: () => DocumentComparisonEntry) => void,
) {
  const baseText = read.base(base)
  const targetText = read.target(target)
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

function addedEntry(
  partName: string,
  paragraph: DocumentParagraphWire,
  read: ParagraphReader,
) {
  return {
    type: 'added' as const,
    storyPartName: partName,
    paragraphId: paragraph.id,
    ...preview(read(paragraph)),
  }
}

function removedEntry(
  partName: string,
  paragraph: DocumentParagraphWire,
  read: ParagraphReader,
) {
  return {
    type: 'removed' as const,
    storyPartName: partName,
    paragraphId: paragraph.id,
    ...preview(read(paragraph)),
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  )
}

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
