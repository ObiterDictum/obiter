import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'

import { batchParagraphDeletions } from './document-edits'
import { emptyFormatDrafts } from './document-format-types'
import { paragraphPlainText } from './document-model-text'
import { runDisplayText } from './document-page-media'
import { layoutDocument } from './document-page-engine'
import { pageReferenceMap } from './document-page-references'
import { emptyDraftState, planDocumentSave } from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { documentStructureToolbar } from './document-structure-toolbar'
import {
  structuralDraftSchema,
  structuralEditOperations,
  type StructuralDraft,
} from './document-structural-drafts'

const tocDraft = (
  id: string,
  paragraphId: string,
  offset: number,
): StructuralDraft => ({
  id,
  kind: 'table-of-contents',
  paragraphId,
  offset,
})

function paragraph(
  id: string,
  text = 'text',
  styleId?: string,
): DocumentParagraphWire {
  return {
    id,
    ...(styleId ? { styleId } : {}),
    runs: text ? [{ id: `${id}-r`, text, preservedXmlFragments: [] }] : [],
    preservedXmlFragments: [],
  }
}

function model(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [bodyStory(paragraphs)],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }
}

function bodyStory(paragraphs: DocumentParagraphWire[]): DocumentStoryWire {
  return {
    partName: 'word/document.xml',
    kind: 'document',
    paragraphs,
    preservedXmlFragments: [],
  }
}

function story(document: DocumentModelWire) {
  return document.stories[0]
}

function fragments(document: DocumentModelWire) {
  return (story(document)?.paragraphs ?? []).flatMap((paragraph) =>
    paragraph.runs.flatMap((run) => run.preservedXmlFragments),
  )
}

describe('table-of-contents drafts', () => {
  it('parses a strict draft and emits the server operation', () => {
    const draft = tocDraft('s1', 'p1', 3)
    expect(structuralDraftSchema.safeParse(draft).success).toBe(true)
    expect(
      structuralDraftSchema.safeParse({ ...draft, entries: [] }).success,
    ).toBe(false)
    expect(structuralEditOperations([draft], new Set<string>())).toEqual([
      { type: 'insert_table_of_contents', paragraphId: 'p1', offset: 3 },
    ])
  })
})

describe('withStructuralDrafts table of contents', () => {
  it('splits the anchor inside a run and splices entry and tail wires', () => {
    // The offset lands strictly inside the anchor's one run — the position
    // where a paragraph split has to reparent run text, not only runs.
    const base = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p2', 'AlphaBeta'),
    ])
    const folded = withStructuralDrafts(base, [tocDraft('s1', 'p2', 5)])
    const paragraphs = story(folded)?.paragraphs ?? []

    expect(paragraphs.map((item) => paragraphPlainText(item))).toEqual([
      'Overview',
      'Alpha',
      'Overview',
      'Beta',
    ])

    // The head keeps the anchor's id and runs; the tail is a new wire whose
    // first run carries the field's `end` marker — all zero-width in the
    // editable stream.
    const head = paragraphs[1]
    const entry = paragraphs[2]
    const tail = paragraphs[3]
    expect(head?.id).toBe('p2')
    expect(tail?.id).not.toBe('p2')
    expect(tail?.runs[0]?.preservedXmlFragments).toEqual([
      '<w:fldChar w:fldCharType="end"/>',
    ])
    expect(tail?.runs[1]?.text).toBe('Beta')

    // The field lives in the first entry wire: begin, the `\o "1-3"`
    // instruction and a `PAGEREF` to the heading's `_Toc` bookmark.
    const xml = fragments(folded).join('')
    expect(xml).toContain(' TOC \\o "1-3" \\u ')
    expect(entry?.styleId).toBe('TOC1')
    const heading = paragraphs[0]
    const bookmark = heading?.preservedXmlFragments.find((fragment) =>
      fragment.includes('w:name="_Toc1"'),
    )
    expect(bookmark).toBeDefined()
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _Toc1'),
        ),
      ),
    ).toBe(true)
  })

  it('migrates a previous tail when a second field lands on the same anchor', () => {
    const base = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p2', 'AlphaBeta'),
    ])
    const folded = withStructuralDrafts(base, [
      tocDraft('s1', 'p2', 5),
      tocDraft('s2', 'p2', 5),
    ])
    const paragraphs = story(folded)?.paragraphs ?? []
    // Head, first field's entry + parked tail (end marker only), second
    // field's entry, then the real tail carrying both ends and the text.
    expect(paragraphs.map((item) => paragraphPlainText(item))).toEqual([
      'Overview',
      'Alpha',
      'Overview',
      '',
      'Overview',
      'Beta',
    ])
    const firstTail = paragraphs[3]
    const lastTail = paragraphs[5]
    expect(firstTail?.runs).toHaveLength(1)
    expect(lastTail?.runs.map((run) => run.text)).toEqual(['', 'Beta'])
  })

  it('reads the heading text the typed draft will save', () => {
    const base = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(base, [tocDraft('s1', 'p2', 0)], {
      'h1-r': 'Retitled',
    })
    const entry = story(folded)?.paragraphs[2]
    expect(paragraphPlainText(entry)).toBe('Retitled')
  })

  it('lists only headings that survive the batch', () => {
    // A heading marked for deletion stays on the painted story, but the
    // writer skips it when it captures entries — so the pending field must
    // skip it too, or the paint promises an entry the save omits.
    const base = model([
      paragraph('h1', 'Doomed', 'Heading1'),
      paragraph('h2', 'Surviving', 'Heading1'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(
      base,
      [tocDraft('s1', 'p2', 0)],
      {},
      new Set(['h1']),
    )
    const paragraphs = story(folded)?.paragraphs ?? []
    expect(paragraphs.map((item) => paragraphPlainText(item))).toEqual([
      'Doomed',
      'Surviving',
      '',
      'Surviving',
      'Anchor',
    ])
    // No `_Toc` fragment lands on the paragraph the save removes.
    expect(
      paragraphs[0]?.preservedXmlFragments.some((fragment) =>
        fragment.includes('_Toc'),
      ),
    ).toBe(false)
  })

  it('folds nothing when the document has no headings', () => {
    const base = model([paragraph('p1', 'Alpha'), paragraph('p2', 'Beta')])
    const folded = withStructuralDrafts(base, [tocDraft('s1', 'p1', 0)])
    expect(folded).toBe(base)
  })

  it('reuses a heading bookmark the stored model already carries', () => {
    const heading = paragraph('h1', 'Overview', 'Heading1')
    heading.preservedXmlFragments.push(
      '<w:bookmarkStart w:id="7" w:name="_Toc4"/>',
      '<w:bookmarkEnd w:id="7"/>',
    )
    const base = model([heading, paragraph('p2', 'Anchor')])
    const folded = withStructuralDrafts(base, [tocDraft('s1', 'p2', 0)])
    const entry = story(folded)?.paragraphs[2]
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _Toc4'),
        ),
      ),
    ).toBe(true)
    // The stored pair is reused, not duplicated.
    expect(
      story(folded)?.paragraphs[0]?.preservedXmlFragments.filter((fragment) =>
        fragment.includes('_Toc'),
      ),
    ).toHaveLength(1)
  })
})

describe('table of contents save partitioning', () => {
  it('blocks a field whose anchor is not a body paragraph', () => {
    const header: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [paragraph('h1', 'Running head')],
      preservedXmlFragments: [],
    }
    const plan = planDocumentSave(
      {
        ...model([paragraph('p1', 'text')]),
        stories: [bodyStory([paragraph('p1', 'text')]), header],
      },
      { ...emptyDraftState(), structures: [tocDraft('s1', 'h1', 0)] },
    )
    expect(plan.operations).toEqual([])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toBe(
      'A table of contents can only be placed in the body.',
    )
  })

  it('sends a body-anchored field as the typed operation', () => {
    const plan = planDocumentSave(
      model([paragraph('h1', 'Overview', 'Heading1'), paragraph('p2', 'x')]),
      { ...emptyDraftState(), structures: [tocDraft('s1', 'p2', 0)] },
    )
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toEqual([
      {
        type: 'insert_table_of_contents',
        paragraphId: 'p2',
        offset: 0,
      },
    ])
  })

  it('holds a field whose only heading the batch replaces', () => {
    // A runless heading carrying typed text saves as an insert plus a
    // delete: its id lands in the writer's `deletedIds` without ever
    // appearing in `deletedParagraphIds`. The partition must read the same
    // effective set — sending the field means the writer captures zero
    // entries and refuses the whole batch on every retry.
    const base = model([paragraph('h1', '', 'Heading1'), paragraph('p2', 'x')])
    const plan = planDocumentSave(base, {
      ...emptyDraftState(),
      extraRuns: {
        h1: [{ id: 'h1-e', text: 'Typed', preservedXmlFragments: [] }],
      },
      structures: [tocDraft('s1', 'p2', 0)],
    })
    // The replacement still saves; the doomed field is the only slot held.
    expect(plan.operations).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'h1',
        text: 'Typed',
        styleId: 'Heading1',
      },
      { type: 'delete_paragraph', paragraphId: 'h1' },
    ])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toContain('no headings')
  })

  it('lists only the heading that survives a replaced paragraph', () => {
    // The same implicit delete as above, but a second heading survives: the
    // field is sent, and the pending fold must capture the survivor alone —
    // the same set the writer's `deletedIds` exclusion produces — so the
    // paint never lists a heading the save removes.
    const base = model([
      paragraph('h1', '', 'Heading1'),
      paragraph('h2', 'Surviving', 'Heading1'),
      paragraph('p3', 'x'),
    ])
    const structures = [tocDraft('s1', 'p3', 0)]
    const extraRuns = {
      h1: [{ id: 'h1-e', text: 'Typed', preservedXmlFragments: [] }],
    }
    const plan = planDocumentSave(base, {
      ...emptyDraftState(),
      extraRuns,
      structures,
    })
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'h1',
        text: 'Typed',
        styleId: 'Heading1',
      },
      { type: 'insert_table_of_contents', paragraphId: 'p3', offset: 0 },
      { type: 'delete_paragraph', paragraphId: 'h1' },
    ])
    const folded = withStructuralDrafts(
      base,
      structures,
      {},
      batchParagraphDeletions(base, [], [], extraRuns, {}).effective,
    )
    const entries = (story(folded)?.paragraphs ?? []).filter(
      (item) => item.styleId === 'TOC1',
    )
    expect(entries.map((item) => paragraphPlainText(item))).toEqual([
      'Surviving',
    ])
  })

  it('counts a heading the same batch is still creating', () => {
    // The heading style is a pending format draft, not a stored style: the
    // writer applies `set_paragraph_style` before the field captures its
    // entries, so the partition must read heading-ness off the same batch
    // rather than the stored wires alone.
    const plan = planDocumentSave(
      model([paragraph('h1', 'Overview'), paragraph('p2', 'x')]),
      {
        ...emptyDraftState(),
        structures: [tocDraft('s1', 'p2', 0)],
        format: {
          emphasis: [],
          paragraphStyles: { h1: 'Heading1' },
          numbering: {},
          paragraphFormats: {},
          section: {},
        },
      },
    )
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toContainEqual({
      type: 'set_paragraph_style',
      paragraphId: 'h1',
      styleId: 'Heading1',
    })
    expect(plan.operations).toContainEqual({
      type: 'insert_table_of_contents',
      paragraphId: 'p2',
      offset: 0,
    })
  })

  it('blocks a reloaded field for every reason the ribbon refuses', () => {
    // A draft persisted before the document changed must not be sent to a
    // writer that will throw — blocking the structure while an unrelated
    // run draft still goes out is the whole point of the partition.
    const cellStory = bodyStory([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('para-w14-CELLP1', 'Cell'),
      paragraph('p2', 'x'),
    ])
    cellStory.preservedXmlFragments = [
      '<w:tbl><w:tr><w:tc><w:p w14:paraId="CELLP1"><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ]
    const cellPlan = planDocumentSave(
      { ...model([]), stories: [cellStory] },
      {
        ...emptyDraftState(),
        structures: [tocDraft('s1', 'para-w14-CELLP1', 0)],
        drafts: { 'p2-r': 'Retyped' },
      },
    )
    expect(cellPlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(cellPlan.blocked[0]?.reason).toContain('cell')
    expect(cellPlan.operations).toEqual([
      { type: 'replace_run_text', runId: 'p2-r', text: 'Retyped' },
    ])

    const section = paragraph('s1a', 'Ends here')
    section.preservedXmlFragments = [
      '<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>',
    ]
    const sectionPlan = planDocumentSave(
      model([paragraph('h1', 'Overview', 'Heading1'), section]),
      { ...emptyDraftState(), structures: [tocDraft('s1', 's1a', 0)] },
    )
    expect(sectionPlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(sectionPlan.blocked[0]?.reason).toContain('section')
    expect(sectionPlan.operations).toEqual([])

    const trackedModel = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('t1', 'Changed'),
    ])
    trackedModel.changes = [
      {
        id: 'c1',
        kind: 'insert',
        elementName: 'ins',
        storyPartName: 'word/document.xml',
        paragraphId: 't1',
        text: 'Changed',
      },
    ]
    const trackedPlan = planDocumentSave(trackedModel, {
      ...emptyDraftState(),
      structures: [tocDraft('s1', 't1', 0)],
    })
    expect(trackedPlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(trackedPlan.blocked[0]?.reason).toContain('tracked')
    expect(trackedPlan.operations).toEqual([])

    const barePlan = planDocumentSave(
      model([paragraph('p1'), paragraph('p2', 'x')]),
      { ...emptyDraftState(), structures: [tocDraft('s1', 'p2', 0)] },
    )
    expect(barePlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(barePlan.blocked[0]?.reason).toContain('no headings')
    expect(barePlan.operations).toEqual([])

    const many = [
      ...Array.from({ length: 501 }, (_, index) =>
        paragraph(`h${String(index)}`, `Heading ${String(index)}`, 'Heading1'),
      ),
      paragraph('p2', 'x'),
    ]
    const crowdedPlan = planDocumentSave(model(many), {
      ...emptyDraftState(),
      structures: [tocDraft('s1', 'p2', 0)],
    })
    expect(crowdedPlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(crowdedPlan.blocked[0]?.reason).toContain('more than')
    expect(crowdedPlan.operations).toEqual([])
  })
})

describe('table of contents ribbon availability', () => {
  const toolbar = (
    overrides: Partial<Parameters<typeof documentStructureToolbar>[0]> = {},
  ) => {
    const structures: StructuralDraft[] = []
    const baseModel = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p1'),
    ])
    const api = documentStructureToolbar({
      paragraphId: 'p1',
      model: baseModel,
      painted: baseModel,
      cellParagraphIds: new Set<string>(),
      offset: 2,
      selectionActive: false,
      selectionRange: null,
      deletedParagraphIds: new Set<string>(),
      trackChanges: false,
      structures,
      drafts: {},
      extraRuns: {},
      format: emptyFormatDrafts,
      breaks: [],
      inserts: [],
      setStructures: (update) => {
        structures.push(...update([]))
      },
      toaFacts: {
        occurrences: [],
        entries: [],
        citingWires: [],
        fields: new Map(),
      },
      ...overrides,
    })
    return { api, structures, baseModel }
  }

  it('enables the control on a stored body paragraph with headings', () => {
    const { api, structures } = toolbar()
    expect(api.tableOfContentsUnavailable).toBeUndefined()
    expect(api.insertTableOfContents()).toEqual({ inserted: true })
    expect(structures).toEqual([
      {
        id: structures[0]?.id ?? '',
        kind: 'table-of-contents',
        paragraphId: 'p1',
        offset: 2,
      },
    ])
  })

  it('refuses honestly when there are no headings or changes are tracked', () => {
    const bare = model([paragraph('p1')])
    expect(
      toolbar({ model: bare, painted: bare }).api.tableOfContentsUnavailable,
    ).toContain('no headings')
    expect(
      toolbar({ trackChanges: true }).api.tableOfContentsUnavailable,
    ).toContain('tracked')
  })

  it('does not count a heading only a pending insert adds', () => {
    // The painted model carries the inserted paragraph with its Heading1
    // style, but no stored paragraph can hold its `PAGEREF` bookmark — the
    // writer skips it, so the count skips it too and a document whose
    // headings are all pending still refuses.
    const stored = model([paragraph('p1')])
    const painted = model([
      paragraph('p1'),
      paragraph('pending-h', 'New heading', 'Heading1'),
    ])
    expect(
      toolbar({ model: stored, painted }).api.tableOfContentsUnavailable,
    ).toContain('no headings')
  })

  it('does not count a heading marked for deletion', () => {
    // The painted story still holds the doomed paragraph, but the
    // partition's heading set excludes it — the ribbon must refuse the
    // same field the save would block.
    const base = model([paragraph('h1', 'Doomed', 'Heading1'), paragraph('p1')])
    expect(
      toolbar({
        model: base,
        painted: base,
        deletedParagraphIds: new Set(['h1']),
      }).api.tableOfContentsUnavailable,
    ).toContain('no headings')
  })

  it('refuses an anchor carrying tracked changes', () => {
    const tracked = model([
      paragraph('h1', 'Overview', 'Heading1'),
      paragraph('p1'),
    ])
    tracked.changes = [
      {
        id: 'c1',
        kind: 'insert',
        elementName: 'ins',
        storyPartName: 'word/document.xml',
        paragraphId: 'p1',
        text: 'Inserted text',
      },
    ]
    expect(
      toolbar({ model: tracked, painted: tracked }).api
        .tableOfContentsUnavailable,
    ).toContain('tracked')
  })

  it('refuses a table cell and a section-ending paragraph', () => {
    expect(
      toolbar({
        paragraphId: 'p1',
        cellParagraphIds: new Set(['p1']),
      }).api.tableOfContentsUnavailable,
    ).toContain('cell')
    const sections = paragraph('p1')
    sections.preservedXmlFragments.push(
      '<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>',
    )
    expect(
      toolbar({ model: model([paragraph('h1', 'H', 'Heading1'), sections]) })
        .api.tableOfContentsUnavailable,
    ).toContain('section')
  })

  it('conflicts with a structure already at the same offset', () => {
    const earlier: StructuralDraft = {
      id: 's0',
      kind: 'page-number',
      paragraphId: 'p1',
      offset: 2,
    }
    expect(
      toolbar({ structures: [earlier] }).api.tableOfContentsUnavailable,
    ).toContain('page number')
  })
})

describe('PAGEREF paint', () => {
  const fieldRun = (instruction: string) => ({
    id: 'r',
    text: '',
    preservedXmlFragments: [
      `<w:fldChar w:fldCharType="separate"/>`,
      `<w:instrText xml:space="preserve">${instruction}</w:instrText>`,
    ],
  })

  it('resolves a stored instruction through the bookmark map', () => {
    expect(
      runDisplayText(fieldRun(' PAGEREF _Toc2 '), 1, new Map([['_Toc2', 4]])),
    ).toBe('4')
    expect(runDisplayText(fieldRun(' PAGEREF _Toc9 '), 1, new Map())).toBe('')
    expect(runDisplayText(fieldRun(' PAGEREF _Toc9 '), 1)).toBe('')
    // `PAGE` still resolves to the painting page, not the map.
    expect(runDisplayText(fieldRun(' PAGE '), 3, new Map([['_Toc2', 4]]))).toBe(
      '3',
    )
  })

  it('paints a tab run as a tab so an entry reads with a gap', () => {
    expect(
      runDisplayText({
        id: 'r',
        text: '',
        preservedXmlFragments: ['<w:tab/>'],
      }),
    ).toBe('\t')
  })

  it('maps a bookmark to the page its paragraph lays out on', () => {
    const heading = paragraph('h1', 'Overview', 'Heading1')
    heading.preservedXmlFragments.push(
      '<w:bookmarkStart w:id="1" w:name="_Toc1"/>',
      '<w:bookmarkEnd w:id="1"/>',
    )
    const base = model([
      paragraph('p1', 'First page'),
      heading,
      paragraph('p2', 'Tail'),
    ])
    const pages = layoutDocument(base, {}, [], {}, undefined, [
      { id: 'b1', kind: 'page', paragraphId: 'h1', offset: 0 },
    ])
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pageReferenceMap(base, pages).get('_Toc1')).toBe(2)
    // A bookmarked paragraph still on the first page reports it.
    heading.preservedXmlFragments.length = 0
    const first = paragraph('p0', 'Top')
    first.preservedXmlFragments.push(
      '<w:bookmarkStart w:id="2" w:name="_Toc9"/>',
      '<w:bookmarkEnd w:id="2"/>',
    )
    const base2 = model([first, paragraph('p2', 'Tail')])
    expect(pageReferenceMap(base2, layoutDocument(base2)).get('_Toc9')).toBe(1)
  })

  it('keeps the first page when a paragraph spans a break', () => {
    // A heading long enough to straddle a page break lays out as two
    // fragments, one per page. Its bookmark opens the paragraph, so
    // `PAGEREF` must name the page the paragraph starts on — not the page
    // its continuation block lands on.
    const heading = paragraph('h1', 'A heading that runs over', 'Heading1')
    heading.preservedXmlFragments.push(
      '<w:bookmarkStart w:id="3" w:name="_Toc3"/>',
      '<w:bookmarkEnd w:id="3"/>',
    )
    const base = model([paragraph('p1', 'Lead'), heading])
    const pages = layoutDocument(base, {}, [], {}, undefined, [
      { id: 'b1', kind: 'page', paragraphId: 'h1', offset: 1 },
    ])
    const fragmentPages = pages
      .map((page, index) =>
        page.blocks.some(
          (block) => block.type === 'paragraph' && block.paragraph.id === 'h1',
        )
          ? index + 1
          : 0,
      )
      .filter((page) => page > 0)
    expect(fragmentPages).toHaveLength(2)
    expect(pageReferenceMap(base, pages).get('_Toc3')).toBe(fragmentPages[0])
  })
})
