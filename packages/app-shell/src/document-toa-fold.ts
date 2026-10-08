import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  FALLBACK_TAB_POSITION_TWIPS,
  tableAuthorityMarkWires,
  tableOfAuthoritiesCitations,
  toaEntryParagraphWire,
  toaHeadingParagraphWire,
  type ToaEntry,
} from '@obiter/ooxml'

import { spliceRunAtOffset } from './document-footnote-fold'
import type { StructuralDraft } from './document-structural-drafts'
import { splitRunsAtOffset } from './document-toc-fold'

const TOA_BOOKMARK_NAME = /<w:bookmarkStart\b[^>]*\bw:name="(_ToA\d+)"/u
const TOA_BOOKMARK_INDEX = /<w:bookmarkStart\b[^>]*\bw:name="_ToA(\d+)"/gu
const BOOKMARK_ID = /<w:bookmarkStart\b[^>]*\bw:id="(\d+)"/gu
const FIELD_END_FRAGMENT = '<w:fldChar w:fldCharType="end"/>'

type ToaDraft = StructuralDraft & { kind: 'table-of-authorities' }

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
   * Splices one pending `TOA` into `paragraphs` — the wire counterpart of
   * the writer's mark pass and `</w:p>`-level splice. The hidden `TA` mark
   * runs fold into every citing paragraph first, the anchor's runs then
   * split at the effective-text offset, and the heading plus one entry
   * wire per distinct citation land between the head and a tail that
   * opens with the field `end` run — the shape the serialised output
   * produces. `_ToA` bookmark fragments attach after the split so a
   * citing paragraph that was the anchor lands them on the head wire.
   */
  return function fold(
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

    // The `TA` marks — before the split, so a citation in the anchor
    // paragraph's head or tail lands in the wire its offset belongs to.
    let markSequence = 0
    for (const hit of occurrences) {
      const at = paragraphs.findIndex(
        (paragraph) => paragraph.id === hit.paragraphId,
      )
      const wire = paragraphs[at]
      if (!wire) continue
      const markIndex = markSequence
      markSequence += 1
      let runSequence = 0
      paragraphs[at] = spliceRunAtOffset(
        wire,
        hit.end,
        tableAuthorityMarkWires(
          () => `${draft.id}:ta${String(markIndex)}:r${String(runSequence++)}`,
          hit.citation,
        ),
        drafts,
        `${draft.id}:ta${String(markIndex)}`,
      )
    }

    const bookmarksById = new Map<
      string,
      { name: string; fragments?: string[] }
    >()
    for (const entry of entries) {
      for (const id of entry.paragraphIds) {
        if (bookmarksById.has(id)) continue
        const wire = paragraphs.find((paragraph) => paragraph.id === id)
        if (wire) bookmarksById.set(id, bookmarkFor(wire))
      }
    }
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
    return true
  }
}
