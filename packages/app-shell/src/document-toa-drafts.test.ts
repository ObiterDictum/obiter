import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentStoryWire,
} from '@obiter/contracts'

import { emptyFormatDrafts } from './document-format-types'
import { paragraphPlainText } from './document-model-text'
import { emptyDraftState, planDocumentSave } from './document-save-plan'
import { withStructuralDrafts } from './document-structure-fold'
import { documentStructureToolbar } from './document-structure-toolbar'
import {
  structuralDraftSchema,
  structuralEditOperations,
  type StructuralDraft,
} from './document-structural-drafts'
import type { TableOfAuthoritiesFacts } from './document-legal-toolbar'

const toaDraft = (
  id: string,
  paragraphId: string,
  offset: number,
): StructuralDraft => ({
  id,
  kind: 'table-of-authorities',
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
    fields: [],
    unanchoredFieldParagraphIds: [],
  }
}

function story(document: DocumentModelWire) {
  return document.stories[0]
}

function fragments(document: DocumentModelWire) {
  return (story(document)?.paragraphs ?? []).flatMap((paragraph) => [
    ...paragraph.preservedXmlFragments,
    ...paragraph.runs.flatMap((run) => run.preservedXmlFragments),
  ])
}

/** The facts the derivations memo reports for a one-citation document. */
function facts(
  citingWires: DocumentParagraphWire[],
  occurrences: { paragraphId: string; end: number; citation: string }[],
): TableOfAuthoritiesFacts {
  const citingByCitation = new Map<string, string[]>()
  for (const hit of occurrences) {
    const citing = citingByCitation.get(hit.citation) ?? []
    if (!citing.includes(hit.paragraphId)) citing.push(hit.paragraphId)
    citingByCitation.set(hit.citation, citing)
  }
  return {
    occurrences,
    entries: [...citingByCitation.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([citation, paragraphIds]) => ({ citation, paragraphIds })),
    citingWires,
    fields: new Map(),
  }
}

describe('table-of-authorities drafts', () => {
  it('parses a strict draft and emits the server operation', () => {
    const draft = toaDraft('s1', 'p1', 3)
    expect(structuralDraftSchema.safeParse(draft).success).toBe(true)
    expect(
      structuralDraftSchema.safeParse({ ...draft, entries: [] }).success,
    ).toBe(false)
    expect(structuralEditOperations([draft], new Set<string>())).toEqual([
      { type: 'insert_table_of_authorities', paragraphId: 'p1', offset: 3 },
    ])
  })
})

describe('withStructuralDrafts table of authorities', () => {
  it('splices the field wires, the mark runs and the citing bookmark', () => {
    const base = model([
      paragraph('c1', 'In [2020] UKSC 1 the court held.'),
      paragraph('p2', 'AlphaBeta'),
    ])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 5)])
    const paragraphs = story(folded)?.paragraphs ?? []

    expect(paragraphs.map((item) => paragraphPlainText(item))).toEqual([
      'In [2020] UKSC 1 the court held.',
      'Alpha',
      'Table of Cases',
      '[2020] UKSC 1',
      'Beta',
    ])

    // The citing wire carries the hidden `TA` mark — three zero-width runs
    // after the citation — and the `_ToA` bookmark the entry's PAGEREF
    // resolves, both the fragments the writer stamps.
    const citing = paragraphs[0]
    expect(
      citing?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TA \\l "[2020] UKSC 1"'),
        ),
      ),
    ).toBe(true)
    expect(
      citing?.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:name="_ToA1"'),
      ),
    ).toBe(true)

    const heading = paragraphs[2]
    expect(heading?.styleId).toBe('TOAHeading')
    expect(
      heading?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TOA '),
        ),
      ),
    ).toBe(true)
    const entry = paragraphs[3]
    expect(entry?.styleId).toBe('TableofAuthorities')
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _ToA1'),
        ),
      ),
    ).toBe(true)
    const tail = paragraphs[4]
    expect(tail?.runs[0]?.preservedXmlFragments).toEqual([
      '<w:fldChar w:fldCharType="end"/>',
    ])
    expect(tail?.runs[1]?.text).toBe('Beta')
  })

  it('splits the citing run around the mark at the citation boundary', () => {
    const base = model([
      paragraph('c1', 'In [2020] UKSC 1 the court held.'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 0)])
    const citing = story(folded)?.paragraphs[0]
    // The citation ends at offset 16: head run keeps the cited text, the
    // three hidden mark runs follow, then the rest of the sentence.
    expect(citing?.runs.map((run) => run.text)).toEqual([
      'In [2020] UKSC 1',
      '',
      '',
      '',
      ' the court held.',
    ])
  })

  it('lists one entry per distinct citation in sorted order', () => {
    const base = model([
      paragraph('c1', 'Applied [2020] UKSC 1 then [2019] EWCA Civ 12.'),
      paragraph('c2', 'See [2020] UKSC 1.'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 0)])
    const paragraphs = story(folded)?.paragraphs ?? []
    const entries = paragraphs.filter(
      (item) => item.styleId === 'TableofAuthorities',
    )
    expect(entries.map((item) => paragraphPlainText(item))).toEqual([
      '[2019] EWCA Civ 12',
      '[2020] UKSC 1, ',
    ])
    // Both citing paragraphs carry a bookmark; the shared citation's entry
    // references each.
    expect(
      paragraphs.filter((item) =>
        item.preservedXmlFragments.some((fragment) =>
          fragment.includes('w:name="_ToA'),
        ),
      ),
    ).toHaveLength(2)
    expect(
      paragraphs[0]?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TA \\l "[2019] EWCA Civ 12"'),
        ),
      ),
    ).toBe(true)
  })

  it('reads the citation text the typed draft will save', () => {
    const base = model([
      paragraph('c1', 'Draft words.'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 0)], {
      'c1-r': 'Now cites [2020] UKSC 1.',
    })
    const paragraphs = story(folded)?.paragraphs ?? []
    const entries = paragraphs.filter(
      (item) => item.styleId === 'TableofAuthorities',
    )
    expect(entries.map((item) => paragraphPlainText(item))).toEqual([
      '[2020] UKSC 1',
    ])
  })

  it('lists only citations that survive the batch', () => {
    const base = model([
      paragraph('c1', 'Doomed [2020] UKSC 1.'),
      paragraph('c2', 'Surviving [2019] UKSC 3.'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(
      base,
      [toaDraft('s1', 'p2', 0)],
      {},
      new Set(['c1']),
    )
    const paragraphs = story(folded)?.paragraphs ?? []
    const entries = paragraphs.filter(
      (item) => item.styleId === 'TableofAuthorities',
    )
    expect(entries.map((item) => paragraphPlainText(item))).toEqual([
      '[2019] UKSC 3',
    ])
    expect(
      paragraphs[0]?.preservedXmlFragments.some((fragment) =>
        fragment.includes('_ToA'),
      ),
    ).toBe(false)
    expect(
      paragraphs[0]?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) => fragment.includes(' TA ')),
      ),
    ).toBe(false)
  })

  it('folds nothing when the document has no citations', () => {
    const base = model([paragraph('p1', 'Alpha'), paragraph('p2', 'Beta')])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p1', 0)])
    expect(folded).toBe(base)
  })

  it('skips a citation inside a generated result paragraph', () => {
    const base = model([
      paragraph('e1', 'Captured [2020] UKSC 1', 'TableofAuthorities'),
      paragraph('c1', 'Real [2019] UKSC 3.'),
      paragraph('p2', 'Anchor'),
    ])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 0)])
    const paragraphs = story(folded)?.paragraphs ?? []
    const entries = paragraphs.filter(
      (item) => item.styleId === 'TableofAuthorities' && item.id !== 'e1',
    )
    expect(entries.map((item) => paragraphPlainText(item))).toEqual([
      '[2019] UKSC 3',
    ])
    // The captured paragraph is never marked or bookmarked.
    expect(fragments(folded).some((f) => f.includes(' TA \\l "[2020]'))).toBe(
      false,
    )
  })

  it('reuses a bookmark the citing paragraph already carries', () => {
    const citing = paragraph('c1', 'Cited [2020] UKSC 1.')
    citing.preservedXmlFragments.push(
      '<w:bookmarkStart w:id="7" w:name="_ToA4"/>',
      '<w:bookmarkEnd w:id="7"/>',
    )
    const base = model([citing, paragraph('p2', 'Anchor')])
    const folded = withStructuralDrafts(base, [toaDraft('s1', 'p2', 0)])
    const entry = (story(folded)?.paragraphs ?? []).find(
      (item) => item.styleId === 'TableofAuthorities',
    )
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _ToA4'),
        ),
      ),
    ).toBe(true)
    expect(
      story(folded)?.paragraphs[0]?.preservedXmlFragments.filter((fragment) =>
        fragment.includes('_ToA'),
      ),
    ).toHaveLength(1)
  })
})

describe('table of authorities save partitioning', () => {
  it('blocks a field whose anchor is not a body paragraph', () => {
    const header: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [paragraph('h1', 'Running head')],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    }
    const plan = planDocumentSave(
      {
        ...model([
          paragraph('c1', 'Cited [2020] UKSC 1.'),
          paragraph('p1', 'text'),
        ]),
        stories: [
          bodyStory([
            paragraph('c1', 'Cited [2020] UKSC 1.'),
            paragraph('p1', 'text'),
          ]),
          header,
        ],
      },
      { ...emptyDraftState(), structures: [toaDraft('s1', 'h1', 0)] },
    )
    expect(plan.operations).toEqual([])
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toBe(
      'A table of authorities can only be placed in the body.',
    )
  })

  it('sends a body-anchored field as the typed operation', () => {
    const plan = planDocumentSave(
      model([paragraph('c1', 'Cited [2020] UKSC 1.'), paragraph('p2', 'x')]),
      { ...emptyDraftState(), structures: [toaDraft('s1', 'p2', 0)] },
    )
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toEqual([
      {
        type: 'insert_table_of_authorities',
        paragraphId: 'p2',
        offset: 0,
      },
    ])
  })

  it('blocks a reloaded field for every reason the ribbon refuses', () => {
    // No citation: the writer would refuse an empty field.
    const barePlan = planDocumentSave(
      model([paragraph('p1'), paragraph('p2', 'x')]),
      { ...emptyDraftState(), structures: [toaDraft('s1', 'p2', 0)] },
    )
    expect(barePlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(barePlan.blocked[0]?.reason).toContain('no citations')
    expect(barePlan.operations).toEqual([])

    // A citing paragraph carrying tracked changes cannot hold the mark.
    const trackedModel = model([
      paragraph('c1', 'Cited [2020] UKSC 1.'),
      paragraph('p2', 'x'),
    ])
    trackedModel.changes = [
      {
        id: 'ch1',
        kind: 'insert',
        elementName: 'ins',
        storyPartName: 'word/document.xml',
        paragraphId: 'c1',
        text: 'Cited',
      },
    ]
    const trackedPlan = planDocumentSave(trackedModel, {
      ...emptyDraftState(),
      structures: [toaDraft('s1', 'p2', 0)],
    })
    expect(trackedPlan.blocked.map((item) => item.slot.kind)).toEqual([
      'structure',
    ])
    expect(trackedPlan.blocked[0]?.reason).toContain('tracked')
    expect(trackedPlan.operations).toEqual([])
  })

  it('blocks a field whose mark lands inside a pending link', () => {
    // The link draft covers the run the citation sits in: the `TA` mark's
    // zero-width splice lands strictly inside it — the same refusal the
    // writer's `w:hyperlink` element check would answer at save.
    const plan = planDocumentSave(
      model([
        paragraph('c1', 'Cited [2020] UKSC 1 fully.'),
        paragraph('p2', 'x'),
      ]),
      {
        ...emptyDraftState(),
        structures: [
          {
            id: 's0',
            kind: 'link',
            paragraphId: 'c1',
            from: 0,
            to: 25,
            target: 'https://example.co.uk/report',
          },
          toaDraft('s1', 'p2', 0),
        ],
      },
    )
    const toaBlock = plan.blocked.find(
      (item) =>
        item.slot.kind === 'structure' &&
        item.slot.structureKind === 'table-of-authorities',
    )
    expect(toaBlock?.reason).toContain('hyperlink')
    // The link itself is unrelated and still goes out.
    expect(
      plan.blocked.filter(
        (item) =>
          item.slot.kind === 'structure' && item.slot.structureKind === 'link',
      ),
    ).toEqual([])
  })

  it('blocks a field whose mark lands inside a stored hyperlink', () => {
    const linked = paragraph('c1', 'Cited [2020] UKSC 1 fully.')
    const run = linked.runs[0]
    if (!run) throw new Error('test paragraph is missing its run')
    run.hyperlinkTarget = 'https://example.com'
    const plan = planDocumentSave(model([linked, paragraph('p2', 'x')]), {
      ...emptyDraftState(),
      structures: [toaDraft('s1', 'p2', 0)],
    })
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toContain('hyperlink')
    expect(plan.operations).toEqual([])
  })
})

describe('table of authorities ribbon availability', () => {
  const toolbar = (
    overrides: Partial<Parameters<typeof documentStructureToolbar>[0]> = {},
  ) => {
    const structures: StructuralDraft[] = []
    const citing = paragraph('c1', 'Cited [2020] UKSC 1.')
    const baseModel = model([citing, paragraph('p2', 'text')])
    const api = documentStructureToolbar({
      paragraphId: 'p2',
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
      toaFacts: facts(
        [citing],
        [{ paragraphId: 'c1', end: 18, citation: '[2020] UKSC 1' }],
      ),
      ...overrides,
    })
    return { api, structures }
  }

  it('enables the control and inserts the draft', () => {
    const { api, structures } = toolbar()
    expect(api.tableOfAuthoritiesUnavailable).toBeUndefined()
    expect(api.insertTableOfAuthorities()).toEqual({ inserted: true })
    expect(structures).toEqual([
      {
        id: structures[0]?.id ?? '',
        kind: 'table-of-authorities',
        paragraphId: 'p2',
        offset: 2,
      },
    ])
  })

  it('names the missing citations when there is nothing to list', () => {
    const { api } = toolbar({
      toaFacts: {
        occurrences: [],
        entries: [],
        citingWires: [],
        fields: new Map(),
      },
    })
    expect(api.tableOfAuthoritiesUnavailable).toContain('no citations')
    const outcome = api.insertTableOfAuthorities()
    expect(outcome.inserted).toBe(false)
  })

  it('names the pending link a mark cannot compose with', () => {
    const citing = paragraph('c1', 'Cited [2020] UKSC 1.')
    const { api } = toolbar({
      structures: [
        {
          id: 's0',
          kind: 'link',
          paragraphId: 'c1',
          from: 0,
          to: 25,
          target: 'https://example.co.uk/report',
        },
      ],
      toaFacts: facts(
        [citing],
        [{ paragraphId: 'c1', end: 18, citation: '[2020] UKSC 1' }],
      ),
    })
    expect(api.tableOfAuthoritiesUnavailable).toContain('hyperlink')
  })

  it('refuses a selection and a pending paragraph like every splice', () => {
    const { api: selected } = toolbar({ selectionActive: true })
    expect(selected.tableOfAuthoritiesUnavailable).toBe(
      'Collapse the selection to insert',
    )
    const { api: pending } = toolbar({ paragraphId: 'new-para' })
    expect(pending.tableOfAuthoritiesUnavailable).toBe(
      'Save the new paragraph before inserting into it',
    )
    const { api: tracked } = toolbar({ trackChanges: true })
    expect(tracked.tableOfAuthoritiesUnavailable).toBe(
      'Insertions are not recorded as a tracked change',
    )
  })
})
