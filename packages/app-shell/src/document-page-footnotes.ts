import type { DocumentModelWire } from '@obiter/contracts'
import type { PendingRedlines } from './document-pending-redlines'
import type { ExtraRuns } from './document-word-edits'
import { documentNotes, runNoteRefs } from './document-page-notes'
import { paragraphMeasure } from './document-page-measure'
import { contentFrame, type ContentFrame } from './document-page-layout'
import { marginBandHeights } from './document-page-margin'
import {
  emptyPage,
  layoutParagraph,
  type LaidOutPage,
  type LaidOutBlock,
  type PageSession,
} from './document-page-blocks'

export function footnoteIdsForBlock(
  block: LaidOutBlock,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  pendingRedlines?: PendingRedlines,
): string[] {
  if (
    block.type === 'paragraph' &&
    !block.paragraph.runs.some((run) =>
      run.preservedXmlFragments.some((xml) =>
        xml.includes('footnoteReference'),
      ),
    )
  )
    return []
  const paragraphs =
    block.type === 'paragraph'
      ? [block.paragraph]
      : block.table.paragraphIds.flatMap(
          (id) =>
            model.stories
              .find((story) => story.kind === 'document')
              ?.paragraphs.filter((p) => p.id === id) ?? [],
        )
  return paragraphs.flatMap((paragraph) => {
    const measure = paragraphMeasure(
      paragraph,
      model,
      block.type === 'paragraph' ? undefined : drafts,
      block.type === 'paragraph' ? {} : extraRuns,
      pendingRedlines,
    )
    let offset = 0
    return measure.paragraph.runs.flatMap((run) => {
      offset += run.text.length
      const at = measure.projection.toDisplay(offset)
      if (
        block.type === 'paragraph' &&
        (at < (block.from ?? 0) ||
          at > (block.to ?? measure.text.length) ||
          (at === (block.to ?? measure.text.length) &&
            at < measure.text.length))
      )
        return []
      return runNoteRefs(run.preservedXmlFragments.join(''), run.id)
        .filter((ref) => ref.kind === 'footnote')
        .map((ref) => ref.noteId)
    })
  })
}

export function attachFootnotes(
  pages: LaidOutPage[],
  notes: readonly LaidOutPage['footnotes'][],
  model: DocumentModelWire,
): void {
  for (const [index, page] of pages.entries()) page.footnotes = notes[index]
  for (let index = pages.length; index < notes.length; index += 1) {
    const last = pages[pages.length - 1]
    if (!last) break
    const frame = contentFrame(
      last.box,
      marginBandHeights(model, last.sectionIndex, false),
    )
    pages.push({
      ...emptyPage(
        last.box,
        {
          ...frame,
          heightPx: Math.max(1, frame.heightPx - (notes[index]?.heightPx ?? 0)),
        },
        last.columns,
      ),
      sectionIndex: last.sectionIndex,
      firstPageOfSection: false,
      footnotes: notes[index],
    })
  }
}

export function sameFootnotePlacement(
  left: readonly LaidOutPage['footnotes'][],
  right: readonly LaidOutPage['footnotes'][],
): boolean {
  const length = (notes: readonly LaidOutPage['footnotes'][]) => {
    let end = notes.length
    while (end > 0 && !notes[end - 1]) end -= 1
    return end
  }
  if (length(left) !== length(right)) return false
  return left.every((note, index) => {
    const other = right[index]
    if (!note || !other) return note === other
    if (note.heightPx !== other.heightPx) return false
    if (note.blocks.length !== other.blocks.length) return false
    return note.blocks.every((block, at) => {
      const counterpart = other.blocks[at]
      if (!counterpart || block.type !== 'paragraph') return false
      if (counterpart.type !== 'paragraph') return false
      return (
        block.paragraph.id === counterpart.paragraph.id &&
        block.from === counterpart.from &&
        block.to === counterpart.to
      )
    })
  })
}

export type FootnoteLayout = {
  notes: LaidOutPage['footnotes'][]
  frames: Map<number, ContentFrame>
  references: Map<string, number>
}

export function layoutFootnotes(
  pages: LaidOutPage[],
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  minimumPages: Map<string, number>,
  pendingRedlines?: PendingRedlines,
  previous?: FootnoteLayout,
): FootnoteLayout {
  const notes = new Map(
    documentNotes(model)
      .filter((note) => note.kind === 'footnote')
      .map((note) => [note.noteId, note]),
  )
  const references = new Map<string, number>()
  const idsByPage = pages.map((page) =>
    page.blocks.flatMap((block) =>
      footnoteIdsForBlock(block, model, drafts, extraRuns, pendingRedlines),
    ),
  )
  idsByPage.forEach((ids, index) => {
    for (const id of ids) {
      if (!references.has(id)) references.set(id, index)
    }
  })
  const frames = new Map<number, ContentFrame>()
  const pageAt = (index: number) => pages[index] ?? pages[pages.length - 1]
  const frameAt = (index: number): ContentFrame => {
    const known = frames.get(index)
    if (known) return known
    const page = pageAt(index)
    if (!page) throw new Error('Footnotes require a document page')
    const base = contentFrame(
      page.box,
      marginBandHeights(
        model,
        page.sectionIndex,
        index < pages.length && page.firstPageOfSection,
      ),
    )
    const bodyLinePx = Math.max(
      24,
      ...page.blocks.flatMap((block) =>
        block.type === 'paragraph'
          ? [
              paragraphMeasure(
                block.paragraph,
                model,
                undefined,
                {},
                pendingRedlines,
              ).linePx,
            ]
          : [],
      ),
    )
    const frame = {
      ...base,
      heightPx: Math.max(1, base.heightPx - 2 * bodyLinePx - 12),
    }
    frames.set(index, frame)
    return frame
  }
  const reuse =
    previous !== undefined &&
    sameReferences(previous.references, references) &&
    [...previous.references.values()].every((index) =>
      sameFrame(previous.frames.get(index), frameAt(index)),
    )
  if (reuse && previous) {
    for (const [id, index] of previous.references) {
      minimumPages.set(id, Math.max(index, minimumPages.get(id) ?? 0))
    }
    return previous
  }
  if (notes.size === 0) return { notes: [], frames, references }
  const used = new Set<string>()
  const result: LaidOutPage['footnotes'][] = []
  let notePage = 0
  let session: PageSession | undefined
  const create = (index: number): PageSession => {
    const page = pageAt(index)
    if (!page) throw new Error('Footnotes require a document page')
    const frame = frameAt(index)
    return {
      page: emptyPage(page.box, frame, [{ left: 0, widthPx: frame.widthPx }]),
      col: 0,
      y: 0,
      broken: false,
      trailingBreak: false,
    }
  }
  const save = () => {
    if (!session || session.page.blocks.length === 0) return
    result[notePage] = { blocks: session.page.blocks, heightPx: session.y + 12 }
  }
  const advance = () => {
    save()
    notePage += 1
    if (!session) throw new Error('Missing footnote session')
    const next = create(notePage)
    Object.assign(session, next)
  }
  for (const [pageIndex, ids] of idsByPage.entries()) {
    for (const id of ids) {
      const note = notes.get(id)
      if (!note || used.has(note.noteId)) continue
      used.add(note.noteId)
      minimumPages.set(id, Math.max(pageIndex, minimumPages.get(id) ?? 0))
      if (!session || notePage < pageIndex) {
        save()
        notePage = pageIndex
        session = create(notePage)
      }
      for (const paragraph of note.paragraphs) {
        layoutParagraph(
          { type: 'paragraph', paragraph },
          model,
          drafts,
          extraRuns,
          new Set(),
          session.page.box,
          session.page.frame,
          session,
          () => ({ left: 0, widthPx: session?.page.frame.widthPx ?? 1 }),
          advance,
          [],
          pendingRedlines,
        )
      }
    }
  }
  save()
  return { notes: result, frames, references }
}

function sameReferences(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  if (left.size !== right.size) return false
  for (const [id, index] of left) {
    if (right.get(id) !== index) return false
  }
  return true
}

function sameFrame(
  left: ContentFrame | undefined,
  right: ContentFrame | undefined,
): boolean {
  if (!left || !right) return left === right
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.left === right.left &&
    left.widthPx === right.widthPx &&
    left.heightPx === right.heightPx
  )
}
