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

/**
 * The pending-fold state for `TOA` drafts: the `_ToA` bookmark name and
 * `w:id` allocators, seeded from the names and ids the painted model
 * already holds — the same scheme `createTableOfContentsFold` runs for
 * `_Toc`, in its own family so the two never share an index. A citing
 * paragraph that already carries a `_ToA` fragment reuses its name,
 * matching the writer's `ensureParagraphBookmark` reuse.
 */
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

  /**
   * One citing paragraph's bookmark name: an existing `_ToA` name on the
   * wire when it has one, otherwise a freshly allocated pair — returned as
   * fragments for the caller to attach, since folded wires are replaced
   * rather than mutated.
   */
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

  /**
   * The citations the fold captures — the shared grammar the writer's
   * `tableOfAuthoritiesCitations` applies — over the painted paragraphs'
   * effective text so a typed draft already shows in the mark it will be
   * spliced after. A paragraph marked for deletion is skipped, matching
   * the writer's `deletedIds` exclusion, and the generated result styles
   * the collector refuses keep a pending entry paragraph out of its own
   * table.
   */
  const citations = (paragraphs: readonly DocumentParagraphWire[]) =>
    tableOfAuthoritiesCitations(
      paragraphs.filter((paragraph) => !deletedIds.has(paragraph.id)),
      (paragraph) =>
        paragraph.runs.map((run) => drafts[run.id] ?? run.text).join(''),
    )

  /**
   * The `TA` marks the painted model folds for one citation set —
   * `spliceRunAtOffset` per occurrence, the wire counterpart of the
   * writer's mark pass. `skipMarked` is the refresh path's deduplication:
   * an occurrence already carrying its mark — stored or folded by an
   * earlier draft — is left alone so a refresh cannot accrete marks.
   */
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

  /**
   * The `_ToA` bookmark names the entries reference, one per citing
   * paragraph — an existing name on the wire when it has one — and the
   * fresh fragments each paragraph still needs, applied after the fold's
   * paragraph splices so a citing paragraph that was the anchor lands
   * them on the head wire.
   */
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
    /**
     * Splices one pending `TOA` into `paragraphs` — the wire counterpart
     * of the writer's mark pass and `</w:p>`-level splice. The hidden
     * `TA` mark runs fold into every citing paragraph first, the
     * anchor's runs then split at the effective-text offset, and the
     * heading plus one entry wire per distinct citation land between the
     * head and a tail that opens with the field `end` run — the shape
     * the serialised output produces.
     */
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

      // The marks fold before the split, so a citation in the anchor
      // paragraph's head or tail lands in the wire its offset belongs to.
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

    /**
     * Rewrites a stored `TOA` field's generated paragraphs in place —
     * the wire counterpart of the update writer's range replacement.
     * The draft names the paragraph holding the field's `begin`: the
     * paragraphs up to the one holding its `end` are replaced by a
     * rebuilt heading and entries, marks fold only where an occurrence
     * is not already marked, and the tail keeps its `end` run and text.
     * The field the draft names comes from the parser's stored metadata —
     * the same pairing and shape the writer proves — so a draft whose
     * field is gone, foreign-shaped, or cannot survive the writer's
     * contract folds nothing and stays pending.
     */
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

/**
 * Whether the citation at `end` already carries its `TA` mark in the
 * painted wires: the mark runs carry no text, so the check walks runs at
 * and after the citation's end offset — an `offset` landing inside a
 * run's text has no mark (the splice that placed one would have split the
 * run), and the first run with text past the point bounds the scan. The
 * match is on the parsed instruction, the writer's own rule, so a mark
 * split across `instrText` runs or written by another tool counts the
 * same.
 */
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
