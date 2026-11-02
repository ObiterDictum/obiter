import type { DocumentModelWire } from '@obiter/contracts'
import type { PendingRedlines } from './document-pending-redlines'
import type { ExtraRuns } from './document-word-edits'
import { documentNotes, runNoteRefs } from './document-page-notes'
import { paragraphMeasure } from './document-page-measure'
import { contentFrame } from './document-page-layout'
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

export function layoutFootnotes(
  pages: LaidOutPage[],
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  pendingRedlines?: PendingRedlines,
): LaidOutPage['footnotes'][] {
  const notes = new Map(
    documentNotes(model)
      .filter((note) => note.kind === 'footnote')
      .map((note) => [note.noteId, note]),
  )
  if (notes.size === 0) return []
  const used = new Set<string>()
  const result: LaidOutPage['footnotes'][] = []
  let notePage = 0
  let session: PageSession | undefined
  const pageAt = (index: number) => pages[index] ?? pages[pages.length - 1]
  const create = (index: number): PageSession => {
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
  for (const [pageIndex, page] of pages.entries()) {
    for (const block of page.blocks) {
      for (const id of footnoteIdsForBlock(
        block,
        model,
        drafts,
        extraRuns,
        pendingRedlines,
      )) {
        const note = notes.get(id)
        if (!note || used.has(note.noteId)) continue
        used.add(note.noteId)
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
  }
  save()
  return result
}
