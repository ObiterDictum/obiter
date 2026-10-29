import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStyleWire,
  DocumentTextRunWire,
} from '@obiter/contracts'
import {
  entryParagraphWire,
  FALLBACK_TAB_POSITION_TWIPS,
  paragraphOutlineLevel,
  type TocEntry,
} from '@obiter/ooxml'

import type { StructuralDraft } from './document-structural-drafts'

const TOC_BOOKMARK_NAME = /<w:bookmarkStart\b[^>]*\bw:name="(_Toc\d+)"/u
const TOC_BOOKMARK_INDEX = /<w:bookmarkStart\b[^>]*\bw:name="_Toc(\d+)"/gu
const BOOKMARK_ID = /<w:bookmarkStart\b[^>]*\bw:id="(\d+)"/gu
const FIELD_END_FRAGMENT = '<w:fldChar w:fldCharType="end"/>'

type TocDraft = StructuralDraft & { kind: 'table-of-contents' }

export function createTableOfContentsFold(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  deletedIds: ReadonlySet<string>,
  nextParaId: () => string,
) {
  const styles = model.styles
  const fragments = model.stories.flatMap((story) =>
    story.paragraphs.flatMap((paragraph) => [
      ...paragraph.preservedXmlFragments,
      ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    ]),
  )
  let nextNameIndex = 1
  let nextBookmarkId = 0
  for (const fragment of fragments) {
    for (const match of fragment.matchAll(TOC_BOOKMARK_INDEX)) {
      const value = Number.parseInt(match[1] ?? '', 10)
      if (Number.isInteger(value) && value >= nextNameIndex) {
        nextNameIndex = value + 1
      }
    }
    for (const match of fragment.matchAll(BOOKMARK_ID)) {
      const value = Number.parseInt(match[1] ?? '', 10)
      if (Number.isInteger(value) && value >= nextBookmarkId) {
        nextBookmarkId = value + 1
      }
    }
  }

  const bookmarkFor = (paragraph: DocumentParagraphWire) => {
    const own = [
      ...paragraph.preservedXmlFragments,
      ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    ]
    for (const fragment of own) {
      const existing = TOC_BOOKMARK_NAME.exec(fragment)?.[1]
      if (existing) return { name: existing }
    }
    const id = nextBookmarkId
    nextBookmarkId += 1
    const name = `_Toc${String(nextNameIndex)}`
    nextNameIndex += 1
    return {
      name,
      fragments: [
        `<w:bookmarkStart w:id="${String(id)}" w:name="${name}"/>`,
        `<w:bookmarkEnd w:id="${String(id)}"/>`,
      ],
    }
  }

  const entries = (paragraphs: readonly DocumentParagraphWire[]) =>
    tableOfContentsEntriesFor(
      paragraphs,
      styles,
      drafts,
      deletedIds,
      bookmarkFor,
    )

  return function fold(
    paragraphs: DocumentParagraphWire[],
    draft: TocDraft,
    tails: Map<string, DocumentParagraphWire>,
  ) {
    const index = paragraphs.findIndex(
      (paragraph) => paragraph.id === draft.paragraphId,
    )
    const anchor = paragraphs[index]
    if (!anchor) return false
    const captured = entries(paragraphs)
    if (captured.length === 0) return false
    const { head, tail } = splitRunsAtOffset(
      anchor.runs,
      draft.offset,
      drafts,
      draft.id,
    )
    let sequence = 0
    const nextRunId = () => `${draft.id}:r${String(sequence++)}`
    const tailParaId = nextParaId()
    const tailWire: DocumentParagraphWire = {
      id: `para-w14-${tailParaId}`,
      sourceParaId: tailParaId,
      ...(anchor.styleId ? { styleId: anchor.styleId } : {}),
      runs: [
        {
          id: nextRunId(),
          text: '',
          preservedXmlFragments: [FIELD_END_FRAGMENT],
        },
        ...tail,
      ],
      preservedXmlFragments: anchor.preservedXmlFragments.filter((fragment) =>
        /^<w:pPr\b/u.test(fragment),
      ),
    }
    const entryWires = captured.map((entry, entryIndex) =>
      entryParagraphWire(
        nextRunId,
        entry,
        nextParaId(),
        entryIndex === 0,
        FALLBACK_TAB_POSITION_TWIPS,
      ),
    )
    paragraphs[index] = { ...anchor, runs: head }
    const previousTail = tails.get(anchor.id)
    const parked = previousTail ? paragraphs.indexOf(previousTail) : -1
    if (previousTail && parked >= 0) {
      paragraphs[parked] = {
        ...previousTail,
        runs: previousTail.runs.slice(0, 1),
      }
      tailWire.runs.push(...previousTail.runs.slice(1))
      paragraphs.splice(parked + 1, 0, ...entryWires, tailWire)
    } else {
      paragraphs.splice(index + 1, 0, ...entryWires, tailWire)
    }
    tails.set(anchor.id, tailWire)
    for (const entry of captured) {
      if (!entry.fragments) continue
      const at = paragraphs.findIndex(
        (paragraph) => paragraph.id === entry.paragraphId,
      )
      const wire = paragraphs[at]
      if (!wire) continue
      paragraphs[at] = {
        ...wire,
        preservedXmlFragments: [
          ...wire.preservedXmlFragments,
          ...entry.fragments,
        ],
      }
    }
    return true
  }
}

type PendingTocEntry = TocEntry & { fragments?: string[] }

function tableOfContentsEntriesFor(
  paragraphs: readonly DocumentParagraphWire[],
  styles: readonly DocumentStyleWire[],
  drafts: Record<string, string>,
  deletedIds: ReadonlySet<string>,
  bookmarkFor: (paragraph: DocumentParagraphWire) => {
    name: string
    fragments?: string[]
  },
): PendingTocEntry[] {
  const entries: PendingTocEntry[] = []
  for (const paragraph of paragraphs) {
    if (deletedIds.has(paragraph.id)) continue
    const level = paragraphOutlineLevel(paragraph, styles)
    if (level === undefined || level >= 3) continue
    const { name, fragments } = bookmarkFor(paragraph)
    entries.push({
      paragraphId: paragraph.id,
      level: level + 1,
      text: paragraph.runs.map((run) => drafts[run.id] ?? run.text).join(''),
      bookmark: name,
      ...(fragments ? { fragments } : {}),
    })
  }
  return entries
}

export function splitRunsAtOffset(
  runs: readonly DocumentTextRunWire[],
  offset: number,
  drafts: Record<string, string>,
  idPrefix: string,
) {
  const head: DocumentTextRunWire[] = []
  const tail: DocumentTextRunWire[] = []
  let cursor = 0
  let past = false
  for (const run of runs) {
    if (past) {
      tail.push(run)
      continue
    }
    const effective = drafts[run.id] ?? run.text
    if (effective.length === 0) {
      head.push(run)
      continue
    }
    const end = cursor + effective.length
    if (offset >= end) {
      head.push(run)
      cursor = end
      continue
    }
    if (offset <= cursor) {
      past = true
      tail.push(run)
      continue
    }
    const within = offset - cursor
    const drafted = drafts[run.id] !== undefined
    head.push({
      ...run,
      ...(drafted ? { id: `${idPrefix}:head` } : {}),
      text: effective.slice(0, within),
    })
    tail.push({
      ...run,
      id: `${idPrefix}:tail`,
      text: effective.slice(within),
      preservedXmlFragments: run.preservedXmlFragments.filter((fragment) =>
        /^<w:rPr\b/u.test(fragment),
      ),
    })
    past = true
  }
  return { head, tail }
}
