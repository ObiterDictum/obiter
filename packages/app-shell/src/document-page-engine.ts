import type { PendingRedlines } from './document-pending-redlines'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  flowIds,
  insertRuns,
  type BreakDraft,
  type LocalInsert,
} from './document-edits'
import type { ExtraRuns } from './document-word-edits'
import { documentStory } from './document-model-text'
import { keepWithNext } from './document-page-keep'
import { paragraphFloatTargets } from './document-page-measure'
import {
  contentFrame,
  documentSections,
  pageBoxForSection,
  sectionColumns,
  type ColumnFrame,
  type ContentFrame,
  type PageBox,
} from './document-page-layout'
import { marginBandHeights } from './document-page-margin'
import { documentNotes } from './document-page-notes'
import { storyBlocks, type StoryBlock } from './document-page-tables'
import { layoutTable } from './document-page-table-flow'
import {
  layoutFootnotes,
  footnoteIdsForBlock,
  attachFootnotes,
  sameFootnotePlacement,
} from './document-page-footnotes'
import {
  previousFootnotePlacement,
  rememberFootnotePlacement,
  type FootnotePlacement,
} from './document-page-footnote-cache'
import {
  emptyPage,
  layoutParagraph,
  type LaidOutPage,
  type LaidOutBlock,
  type PageSession,
} from './document-page-blocks'

export type { ContentFrame } from './document-page-layout'
export { contentFrame } from './document-page-layout'
export type {
  LaidOutBlock,
  LaidOutPage,
  LaidOutParagraph,
  LaidOutTable,
} from './document-page-blocks'

export type DocumentLayoutFlow = { kind: 'web'; widthPx: number }

const WEB_FRAME_HEIGHT_PX = 10_000_000
const MAX_FOOTNOTE_PASSES = 8

export function layoutDocument(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
  inserts: LocalInsert[] = [],
  extraRuns: ExtraRuns = {},
  blocks?: StoryBlock[],
  pageBreaks: readonly BreakDraft[] = [],
  flow?: DocumentLayoutFlow,
  pendingRedlines?: PendingRedlines,
): LaidOutPage[] {
  const hasFootnotes = documentNotes(model).some(
    (note) => note.kind === 'footnote',
  )
  if (flow?.kind === 'web' || !hasFootnotes)
    return layoutBody(
      model,
      drafts,
      inserts,
      extraRuns,
      blocks,
      pageBreaks,
      flow,
      pendingRedlines,
    )
  const cacheable =
    !inserts.length &&
    !Object.keys(extraRuns).length &&
    !pageBreaks.length &&
    !pendingRedlines
  const previous = cacheable
    ? previousFootnotePlacement(model, drafts, blocks)
    : undefined
  if (previous?.reusable) {
    const notes = previous.layout.notes
    const minimumPages = new Map(previous.minimumPages)
    const pages = layoutBody(
      model,
      drafts,
      inserts,
      extraRuns,
      blocks,
      pageBreaks,
      flow,
      pendingRedlines,
      notes,
      minimumPages,
    )
    attachFootnotes(pages, notes, model)
    rememberFootnotePlacement(
      model,
      drafts,
      pages,
      previous.layout,
      minimumPages,
      blocks,
    )
    return pages
  }
  if (previous) {
    const reseeded = reuseFootnotePlacement(previous, model, drafts, blocks)
    if (reseeded) return reseeded
  }
  let notes: LaidOutPage['footnotes'][] = []
  const minimumPages = new Map<string, number>()
  let pages: LaidOutPage[] = []
  for (let pass = 0; pass < MAX_FOOTNOTE_PASSES; pass += 1) {
    pages = layoutBody(
      model,
      drafts,
      inserts,
      extraRuns,
      blocks,
      pageBreaks,
      flow,
      pendingRedlines,
      notes,
      minimumPages,
    )
    const layout = layoutFootnotes(
      pages,
      model,
      drafts,
      extraRuns,
      minimumPages,
      pendingRedlines,
    )
    const stable = sameFootnotePlacement(layout.notes, notes)
    notes = layout.notes
    if (stable || pass === MAX_FOOTNOTE_PASSES - 1) {
      attachFootnotes(pages, notes, model)
      if (cacheable && stable)
        rememberFootnotePlacement(
          model,
          drafts,
          pages,
          layout,
          minimumPages,
          blocks,
        )
      return pages
    }
  }
  return pages
}

function reuseFootnotePlacement(
  previous: FootnotePlacement,
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  blocks?: StoryBlock[],
): LaidOutPage[] | undefined {
  const minimumPages = new Map<string, number>()
  const notes = previous.layout.notes
  const pages = layoutBody(
    model,
    drafts,
    [],
    {},
    blocks,
    [],
    undefined,
    undefined,
    notes,
    minimumPages,
  )
  const layout = layoutFootnotes(
    pages,
    model,
    drafts,
    {},
    minimumPages,
    undefined,
    previous.layout,
  )
  if (layout !== previous.layout) return
  attachFootnotes(pages, notes, model)
  rememberFootnotePlacement(model, drafts, pages, layout, minimumPages, blocks)
  return pages
}

function layoutBody(
  model: DocumentModelWire,
  drafts?: Record<string, string>,
  inserts: LocalInsert[] = [],
  extraRuns: ExtraRuns = {},
  blocks?: StoryBlock[],
  pageBreaks: readonly BreakDraft[] = [],
  flow?: DocumentLayoutFlow,
  pendingRedlines?: PendingRedlines,
  notes: readonly LaidOutPage['footnotes'][] = [],
  minimumPages?: ReadonlyMap<string, number>,
): LaidOutPage[] {
  const web = flow?.kind === 'web' ? flow : undefined
  const sections = documentSections(model)
  const breakOffsets = new Map<string, number[]>()
  for (const item of pageBreaks) {
    if (item.kind !== 'page') continue
    const list = breakOffsets.get(item.paragraphId) ?? []
    list.push(item.offset)
    breakOffsets.set(item.paragraphId, list)
  }
  for (const list of breakOffsets.values()) {
    list.sort((left, right) => left - right)
  }
  const geometryFor = (
    sectionXml: string,
    sectionIndex = 0,
    firstPage = true,
  ) => {
    if (web) {
      const box: PageBox = {
        widthPx: web.widthPx,
        heightPx: WEB_FRAME_HEIGHT_PX,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
        headerPx: 0,
        footerPx: 0,
      }
      const frame = contentFrame(box)
      return { box, frame, columns: [{ left: 0, widthPx: frame.widthPx }] }
    }
    const sectionBox = pageBoxForSection(sectionXml)
    return {
      box: sectionBox,
      frame: contentFrame(
        sectionBox,
        marginBandHeights(model, sectionIndex, firstPage, sections),
      ),
      columns: sectionColumns(sectionBox, sectionXml),
    }
  }
  const geometries = sections.map((section, index) =>
    geometryFor(section.xml, index),
  )
  const continuationGeometries = sections.map((section, index) =>
    geometryFor(section.xml, index, false),
  )
  let geometry = geometries[0] ?? geometryFor('')
  const story = documentStory(model)
  if (!story || story.paragraphs.length === 0) {
    return [emptyPage(geometry.box, geometry.frame, geometry.columns)]
  }

  const boxed = new Set<string>()
  const hosts = new Set<string>()
  for (const paragraph of story.paragraphs) {
    const targets = paragraphFloatTargets(paragraph)
    if (!targets.host) continue
    hosts.add(paragraph.id)
    for (const id of targets.boxed) boxed.add(id)
  }
  const source = storyBlocksWithInserts(
    (blocks ?? storyBlocks(story)).filter(
      (block) => block.type === 'table' || !boxed.has(block.paragraph.id),
    ),
    inserts,
  )
  const pages: LaidOutPage[] = []
  let sectionIndex = 0
  let sectionStartPage = 0
  const newPage = () => {
    const footnotes = notes[pages.length]
    const firstPageOfSection = pages.length === sectionStartPage
    const base = firstPageOfSection
      ? geometry
      : (continuationGeometries[sectionIndex] ?? geometry)
    const frame = {
      ...base.frame,
      heightPx: Math.max(1, base.frame.heightPx - (footnotes?.heightPx ?? 0)),
    }
    return {
      ...emptyPage(base.box, frame, base.columns),
      sectionIndex,
      firstPageOfSection,
      footnotes,
    }
  }
  const session: PageSession = {
    page: newPage(),
    col: 0,
    y: 0,
    broken: false,
    trailingBreak: false,
  }

  const column = () =>
    geometry.columns[session.col] ??
    geometry.columns[0] ?? { left: 0, widthPx: geometry.frame.widthPx }

  const pushPage = () => {
    if (web) session.page.contentPx = session.y
    pages.push(session.page)
  }

  const advance = () => {
    if (session.col + 1 < geometry.columns.length) {
      session.col += 1
      session.y = 0
      session.broken = true
      session.trailingBreak = false
      return
    }
    pushPage()
    session.page = newPage()
    session.col = 0
    session.y = 0
    session.broken = true
    session.trailingBreak = false
  }

  const startSection = () => {
    sectionIndex += 1
    geometry = geometries[sectionIndex] ?? geometry
    if (
      session.page.blocks.length > 0 ||
      session.page.floats.length > 0 ||
      session.page.textBoxes.length > 0
    ) {
      pushPage()
    }
    sectionStartPage = pages.length
    session.page = newPage()
    session.col = 0
    session.y = 0
    session.broken = true
    session.trailingBreak = false
  }

  const beforePlace = minimumPages?.size
    ? (block: LaidOutBlock) =>
        footnoteIdsForBlock(
          block,
          model,
          drafts,
          extraRuns,
          pendingRedlines,
        ).every((id) => pages.length >= (minimumPages.get(id) ?? 0))
    : undefined

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index]
    if (item.type === 'table') {
      layoutTable(
        item.table,
        model,
        drafts,
        extraRuns,
        session,
        column,
        advance,
        pendingRedlines,
        beforePlace,
      )
      continue
    }
    keepWithNext(
      source,
      index,
      model,
      drafts,
      extraRuns,
      session.page.frame,
      column(),
      session,
      advance,
      pendingRedlines,
    )
    const offsets = breakOffsets.get(item.paragraph.id) ?? []
    layoutParagraph(
      item,
      model,
      drafts,
      extraRuns,
      hosts,
      geometry.box,
      session.page.frame,
      session,
      column,
      advance,
      offsets,
      pendingRedlines,
      beforePlace,
    )
    if (
      sections[sectionIndex]?.endParagraphId === item.paragraph.id &&
      sectionIndex + 1 < sections.length
    ) {
      startSection()
    }
  }

  layoutNotes(
    model,
    drafts,
    extraRuns,
    hosts,
    geometry.box,
    session.page.frame,
    session,
    column,
    advance,
    pendingRedlines,
    Boolean(web),
  )

  if (
    session.page.blocks.length > 0 ||
    session.page.floats.length > 0 ||
    session.page.textBoxes.length > 0 ||
    session.trailingBreak ||
    pages.length === 0
  ) {
    pushPage()
  }
  return pages
}

function layoutNotes(
  model: DocumentModelWire,
  drafts: Record<string, string> | undefined,
  extraRuns: ExtraRuns,
  hosts: Set<string>,
  box: PageBox,
  frame: ContentFrame,
  session: PageSession,
  column: () => ColumnFrame,
  advance: () => void,
  pendingRedlines?: PendingRedlines,
  includeFootnotes = false,
): void {
  const notes = documentNotes(model).filter(
    (note) => includeFootnotes || note.kind === 'endnote',
  )
  if (notes.length === 0) return
  if (session.y > 0) {
    session.y += 12
  }
  for (const note of notes) {
    for (const paragraph of note.paragraphs) {
      layoutParagraph(
        { type: 'paragraph', paragraph },
        model,
        drafts,
        extraRuns,
        hosts,
        box,
        frame,
        session,
        column,
        advance,
        [],
        pendingRedlines,
      )
    }
  }
}

export function storyBlocksWithInserts(
  blocks: StoryBlock[],
  inserts: LocalInsert[],
): StoryBlock[] {
  if (inserts.length === 0) return blocks
  const insertById = new Map(inserts.map((item) => [item.clientId, item]))
  const hostIds: string[] = []
  const hostBlock = new Map<string, StoryBlock>()
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      hostIds.push(block.paragraph.id)
      hostBlock.set(block.paragraph.id, block)
    } else {
      for (const id of block.table.paragraphIds) {
        hostIds.push(id)
        hostBlock.set(id, block)
      }
    }
  }
  const seen = new Set<StoryBlock>()
  const result: StoryBlock[] = []
  for (const id of flowIds(hostIds, inserts)) {
    const insert = insertById.get(id)
    if (insert) {
      result.push({
        type: 'paragraph',
        paragraph: {
          id: insert.clientId,
          runs: insertRuns(insert),
          preservedXmlFragments: [],
        },
      })
      continue
    }
    const block = hostBlock.get(id)
    if (!block || seen.has(block)) continue
    seen.add(block)
    result.push(block)
  }
  return result
}
