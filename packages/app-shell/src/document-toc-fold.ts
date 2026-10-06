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

/**
 * The pending-fold state for `TOC` drafts: the `_Toc` bookmark name and
 * `w:id` allocators, seeded from the names and ids the painted model
 * already holds. A heading that already carries a `_Toc` fragment — stored
 * or folded by an earlier draft — reuses its name, matching the writer's
 * `ensureParagraphBookmark` reuse, so the names the pending `PAGEREF`s
 * resolve are the same ones the save allocates.
 */
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

  /**
   * One heading wire's bookmark name: an existing `_Toc` name on the wire
   * when it has one, otherwise a freshly allocated pair — returned as
   * fragments for the caller to attach, since folded wires are replaced
   * rather than mutated.
   */
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

  /**
   * The entries the fold captures — the same heading rule the writer's
   * `tableOfContentsEntries` applies, over the painted paragraphs so an
   * earlier pending fold's head paragraph reports its post-split text.
   */
  const entries = (paragraphs: readonly DocumentParagraphWire[]) =>
    tableOfContentsEntriesFor(paragraphs, styles, drafts, deletedIds, bookmarkFor)

  /**
   * Splices one pending `TOC` into `paragraphs` — the wire counterpart of
   * the writer's `</w:p>`-level splice. The anchor's runs split at the
   * effective-text offset: head runs stay on the anchor wire, the tail
   * moves behind the field `end` run into a new wire after the entry
   * wires. A second draft on the same anchor migrates the previous tail's
   * text runs into the newest tail — the shape the serialised output
   * produces, where the last `</w:p>`-opening tail carries all the text.
   * `tails` is the map the table fold parks trailing wires in, so a table
   * anchored here still chains after the field.
   */
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
    // Pending bookmark fragments attach after the split so a heading that
    // was the anchor lands them on the head wire — the same wire the
    // writer's `bookmarkStart` serialises into.
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

/**
 * Heading paragraphs at outline levels 1-3 in painted order — the painted
 * twin of the writer's `tableOfContentsEntries`, reading effective text so
 * a typed heading edit already in the draft shows in the entry it will
 * capture. A paragraph marked for deletion stays painted but is skipped,
 * matching the heading set the writer's `deletedIds` exclusion captures.
 */
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

/**
 * Splits `runs` at the effective-text `offset` — the wire twin of the
 * writer's run reparenting. Zero-length runs stay with the head; a run
 * the draft state replaces loses its id on both halves so the draft does
 * not repaint over a split, the rule `spliceRunAtOffset` uses.
 */
function splitRunsAtOffset(
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
