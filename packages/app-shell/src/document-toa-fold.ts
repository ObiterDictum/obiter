import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  FALLBACK_TAB_POSITION_TWIPS,
  fieldInstructionsInXml,
  tableAuthorityMarkMatches,
  tableAuthorityMarkWires,
  tableOfAuthoritiesCitations,
  toaEntryParagraphWire,
  toaHeadingParagraphWire,
  type ToaEntry,
} from '@obiter/ooxml'

import { spliceRunAtOffset } from './document-footnote-fold'
import { documentStory } from './document-model-text'
import type { StructuralDraft } from './document-structural-drafts'
import { tableOfAuthoritiesFields } from './document-toa-availability'
import { splitRunsAtOffset } from './document-toc-fold'

const TOA_BOOKMARK_NAME = /<w:bookmarkStart\b[^>]*\bw:name="(_ToA\d+)"/u
const TOA_BOOKMARK_INDEX = /<w:bookmarkStart\b[^>]*\bw:name="_ToA(\d+)"/gu
const BOOKMARK_ID = /<w:bookmarkStart\b[^>]*\bw:id="(\d+)"/gu
const FIELD_END_FRAGMENT = '<w:fldChar w:fldCharType="end"/>'

type ToaDraft = StructuralDraft & { kind: 'table-of-authorities' }
type ToaRefreshDraft = StructuralDraft & {
  kind: 'table-of-authorities-refresh'
}

export function createTableOfAuthoritiesFold(
  model: DocumentModelWire,
  drafts: Record<string, string>,
  deletedIds: ReadonlySet<string>,
  nextParaId: () => string,
) {
  const fragments = model.stories.flatMap((story) =>
    story.paragraphs.flatMap((paragraph) => [
      ...paragraph.preservedXmlFragments,
      ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
    ]),
  )
  let nextNameIndex = 1
  let nextBookmarkId = 0
  for (const fragment of fragments) {
    for (const match of fragment.matchAll(TOA_BOOKMARK_INDEX)) {
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
      const existing = TOA_BOOKMARK_NAME.exec(fragment)?.[1]
      if (existing) return { name: existing }
    }
    const id = nextBookmarkId
    nextBookmarkId += 1
    const name = `_ToA${String(nextNameIndex)}`
    nextNameIndex += 1
    return {
      name,
      fragments: [
        `<w:bookmarkStart w:id="${String(id)}" w:name="${name}"/>`,
        `<w:bookmarkEnd w:id="${String(id)}"/>`,
      ],
    }
  }

  const citations = (paragraphs: readonly DocumentParagraphWire[]) =>
    tableOfAuthoritiesCitations(
      paragraphs.filter((paragraph) => !deletedIds.has(paragraph.id)),
      (paragraph) =>
        paragraph.runs.map((run) => drafts[run.id] ?? run.text).join(''),
    )

  const foldMarks = (
    paragraphs: DocumentParagraphWire[],
    draftId: string,
    occurrences: readonly {
      paragraphId: string
      end: number
      citation: string
    }[],
    skipMarked: boolean,
  ) => {
    let markSequence = 0
    for (const hit of occurrences) {
      const at = paragraphs.findIndex(
        (paragraph) => paragraph.id === hit.paragraphId,
      )
      const wire = paragraphs[at]
      if (!wire) continue
      if (
        skipMarked &&
        hasAuthorityMarkAtWire(wire, hit.end, hit.citation, drafts)
      ) {
        continue
      }
      const markIndex = markSequence
      markSequence += 1
      let runSequence = 0
      paragraphs[at] = spliceRunAtOffset(
        wire,
        hit.end,
        tableAuthorityMarkWires(
          () => `${draftId}:ta${String(markIndex)}:r${String(runSequence++)}`,
          hit.citation,
        ),
        drafts,
        `${draftId}:ta${String(markIndex)}`,
      )
    }
  }

  const bookmarksFor = (
    paragraphs: readonly DocumentParagraphWire[],
    entries: readonly { paragraphIds: readonly string[] }[],
  ) => {
    const byId = new Map<string, { name: string; fragments?: string[] }>()
    for (const entry of entries) {
      for (const id of entry.paragraphIds) {
        if (byId.has(id)) continue
        const wire = paragraphs.find((paragraph) => paragraph.id === id)
        if (wire) byId.set(id, bookmarkFor(wire))
      }
    }
    return byId
  }

  const attachBookmarks = (
    paragraphs: DocumentParagraphWire[],
    bookmarksById: ReadonlyMap<string, { name: string; fragments?: string[] }>,
  ) => {
    for (const [id, bookmark] of bookmarksById) {
      if (!bookmark.fragments) continue
      const at = paragraphs.findIndex((paragraph) => paragraph.id === id)
      const wire = paragraphs[at]
      if (!wire) continue
      paragraphs[at] = {
        ...wire,
        preservedXmlFragments: [
          ...wire.preservedXmlFragments,
          ...bookmark.fragments,
        ],
      }
    }
  }

  return {
    insert(
      paragraphs: DocumentParagraphWire[],
      draft: ToaDraft,
      tails: Map<string, DocumentParagraphWire>,
    ) {
      const index = paragraphs.findIndex(
        (paragraph) => paragraph.id === draft.paragraphId,
      )
      const anchor = paragraphs[index]
      if (!anchor) return false
      const { occurrences, entries } = citations(paragraphs)
      if (entries.length === 0) return false

      foldMarks(paragraphs, draft.id, occurrences, false)
      const bookmarksById = bookmarksFor(paragraphs, entries)
      const toaEntries: ToaEntry[] = entries.map((entry) => ({
        ...entry,
        bookmarks: entry.paragraphIds.flatMap((id) => {
          const bookmark = bookmarksById.get(id)
          return bookmark ? [bookmark.name] : []
        }),
      }))

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
      const insertedWires = [
        toaHeadingParagraphWire(nextRunId, nextParaId()),
        ...toaEntries.map((entry) =>
          toaEntryParagraphWire(
            nextRunId,
            entry,
            nextParaId(),
            FALLBACK_TAB_POSITION_TWIPS,
          ),
        ),
      ]
      paragraphs[index] = { ...anchor, runs: head }
      const previousTail = tails.get(anchor.id)
      const parked = previousTail ? paragraphs.indexOf(previousTail) : -1
      if (previousTail && parked >= 0) {
        paragraphs[parked] = {
          ...previousTail,
          runs: previousTail.runs.slice(0, 1),
        }
        tailWire.runs.push(...previousTail.runs.slice(1))
        paragraphs.splice(parked + 1, 0, ...insertedWires, tailWire)
      } else {
        paragraphs.splice(index + 1, 0, ...insertedWires, tailWire)
      }
      tails.set(anchor.id, tailWire)
      attachBookmarks(paragraphs, bookmarksById)
      return true
    },

    refresh(paragraphs: DocumentParagraphWire[], draft: ToaRefreshDraft) {
      const field = tableOfAuthoritiesFields(documentStory(model)).get(
        draft.paragraphId,
      )
      if (!field || !field.rangeReplaceable) return false
      const removedIds = new Set(field.resultIds)
      const { occurrences, entries } = citations(
        paragraphs.filter((paragraph) => !removedIds.has(paragraph.id)),
      )
      if (entries.length === 0) return false

      foldMarks(paragraphs, draft.id, occurrences, true)
      const bookmarksById = bookmarksFor(paragraphs, entries)
      const toaEntries: ToaEntry[] = entries.map((entry) => ({
        ...entry,
        bookmarks: entry.paragraphIds.flatMap((id) => {
          const bookmark = bookmarksById.get(id)
          return bookmark ? [bookmark.name] : []
        }),
      }))
      let sequence = 0
      const nextRunId = () => `${draft.id}:r${String(sequence++)}`
      const insertedWires = [
        toaHeadingParagraphWire(nextRunId, nextParaId()),
        ...toaEntries.map((entry) =>
          toaEntryParagraphWire(
            nextRunId,
            entry,
            nextParaId(),
            FALLBACK_TAB_POSITION_TWIPS,
          ),
        ),
      ]
      const headIndex = paragraphs.findIndex(
        (paragraph) => paragraph.id === field.headId,
      )
      const tailIndex = paragraphs.findIndex(
        (paragraph, index) =>
          index > headIndex &&
          field.paragraphIds[field.paragraphIds.length - 1] === paragraph.id,
      )
      if (headIndex === -1 || tailIndex === -1) return false
      paragraphs.splice(headIndex, tailIndex - headIndex, ...insertedWires)
      attachBookmarks(paragraphs, bookmarksById)
      return true
    },
  }
}

function hasAuthorityMarkAtWire(
  wire: DocumentParagraphWire,
  end: number,
  citation: string,
  drafts: Record<string, string>,
) {
  const marks: DocumentParagraphWire['runs'] = []
  let cursor = 0
  for (const run of wire.runs) {
    const length = (drafts[run.id] ?? run.text).length
    if (cursor === end) {
      if (length > 0) break
      marks.push(run)
      continue
    }
    if (cursor + length > end) return false
    cursor += length
  }
  if (cursor !== end) return false
  const xml = marks.map((run) => run.preservedXmlFragments.join('')).join('')
  return fieldInstructionsInXml(xml).some((instruction) =>
    tableAuthorityMarkMatches(instruction, citation),
  )
}
