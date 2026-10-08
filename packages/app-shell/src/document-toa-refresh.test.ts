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
import {
  createTableOfAuthoritiesFacts,
  tableOfAuthoritiesFields,
} from './document-toa-availability'

const FIELD_BEGIN = '<w:fldChar w:fldCharType="begin"/>'
const FIELD_SEPARATE = '<w:fldChar w:fldCharType="separate"/>'
const FIELD_END = '<w:fldChar w:fldCharType="end"/>'
const TOA_INSTR =
  '<w:instrText xml:space="preserve"> TOA \\h \\c "1" </w:instrText>'
const TA_MARK = (citation: string) =>
  `<w:instrText xml:space="preserve"> TA \\l "${citation}" \\s "${citation}" \\c 1 </w:instrText>`

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

function fieldRun(id: string, fragments: string[]) {
  return { id, text: '', preservedXmlFragments: fragments }
}

/** The generated heading wire — the field's `begin`, instruction and
 * `separate` ahead of its result text, as `toaHeadingParagraphWire` builds. */
function fieldHead(id: string): DocumentParagraphWire {
  return {
    id,
    sourceParaId: id,
    styleId: 'TOAHeading',
    runs: [
      fieldRun(`${id}-r1`, [FIELD_BEGIN]),
      fieldRun(`${id}-r2`, [TOA_INSTR]),
      fieldRun(`${id}-r3`, [FIELD_SEPARATE]),
      { id: `${id}-r4`, text: 'Table of Cases', preservedXmlFragments: [] },
    ],
    preservedXmlFragments: ['<w:pPr><w:pStyle w:val="TOAHeading"/></w:pPr>'],
  }
}

function fieldEntry(id: string, citation: string): DocumentParagraphWire {
  return {
    id,
    sourceParaId: id,
    styleId: 'TableofAuthorities',
    runs: [
      { id: `${id}-r1`, text: citation, preservedXmlFragments: [] },
      fieldRun(`${id}-r2`, ['<w:tab/>']),
      fieldRun(`${id}-r3`, [FIELD_BEGIN]),
      fieldRun(`${id}-r4`, [
        `<w:instrText xml:space="preserve"> PAGEREF _ToA1 </w:instrText>`,
      ]),
      fieldRun(`${id}-r5`, [FIELD_END]),
    ],
    preservedXmlFragments: [],
  }
}

/** The tail wire — the field's `end` run ahead of the anchor's rest text. */
function fieldTail(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    sourceParaId: id,
    runs: [
      fieldRun(`${id}-r1`, [FIELD_END]),
      { id: `${id}-r2`, text, preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [],
  }
}

/** A citing wire carrying its stored `TA` mark runs after the citation. */
function citingWithMark(id: string, citation: string): DocumentParagraphWire {
  return {
    id,
    runs: [
      { id: `${id}-r1`, text: `Cited ${citation}`, preservedXmlFragments: [] },
      fieldRun(`${id}-m1`, [FIELD_BEGIN]),
      fieldRun(`${id}-m2`, [TA_MARK(citation)]),
      fieldRun(`${id}-m3`, [FIELD_END]),
      { id: `${id}-r2`, text: '.', preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [
      '<w:bookmarkStart w:id="4" w:name="_ToA1"/><w:bookmarkEnd w:id="4"/>',
    ],
  }
}

function refreshDraft(id: string, paragraphId: string): StructuralDraft {
  return { id, kind: 'table-of-authorities-refresh', paragraphId }
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

function facts(
  paragraphs: DocumentParagraphWire[],
  overrides: {
    paragraphStyles?: Record<string, string | null>
    batchDeletions?: ReadonlySet<string>
    drafts?: Record<string, string>
    extraRuns?: Record<string, DocumentParagraphWire['runs']>
  } = {},
) {
  return createTableOfAuthoritiesFacts({
    model: model(paragraphs),
    batchDeletions: overrides.batchDeletions ?? new Set(),
    drafts: overrides.drafts ?? {},
    extraRuns: overrides.extraRuns ?? {},
    paragraphStyles: overrides.paragraphStyles ?? {},
  })()
}

describe('table-of-authorities refresh draft', () => {
  it('parses a strict draft and emits the server operation', () => {
    const draft = refreshDraft('s1', 'head')
    expect(structuralDraftSchema.safeParse(draft).success).toBe(true)
    expect(
      structuralDraftSchema.safeParse({
        id: 's1',
        kind: 'table-of-authorities-refresh',
        paragraphId: 'head',
        offset: 3,
      }).success,
    ).toBe(false)
    expect(structuralEditOperations([draft], new Set<string>())).toEqual([
      { type: 'update_table_of_authorities', paragraphId: 'head' },
    ])
  })
})

describe('tableOfAuthoritiesFields', () => {
  it('maps the head paragraph to the range the field covers', () => {
    const fields = tableOfAuthoritiesFields([
      paragraph('before'),
      fieldHead('head'),
      fieldEntry('e1', '[2020] UKSC 1'),
      fieldTail('tail', 'rest'),
      paragraph('after'),
    ])
    const field = fields.get('head')
    expect(field).toEqual({
      headId: 'head',
      resultIds: ['head', 'e1'],
      paragraphIds: ['head', 'e1', 'tail'],
    })
    expect(fields.size).toBe(1)
  })

  it('drops an unbalanced field and keeps the balanced one', () => {
    const fields = tableOfAuthoritiesFields([
      fieldHead('head'),
      fieldTail('tail', 'rest'),
      fieldHead('broken'),
      paragraph('plain'),
    ])
    expect(fields.get('head')?.paragraphIds).toEqual(['head', 'tail'])
    expect(fields.has('broken')).toBe(false)
  })
})

describe('table-of-authorities facts with pending paragraph styles', () => {
  it('skips a citation whose paragraph a pending style marks generated', () => {
    const computed = facts([paragraph('c1', 'Cited [2020] UKSC 1.')], {
      paragraphStyles: { c1: 'TableofAuthorities' },
    })
    expect(computed.entries).toEqual([])
    expect(computed.occurrences).toEqual([])
  })

  it('collects a citation a pending style removal exposes', () => {
    const computed = facts(
      [paragraph('c1', 'Cited [2020] UKSC 1.', 'TableofAuthorities')],
      { paragraphStyles: { c1: null } },
    )
    expect(computed.entries).toEqual([
      { citation: '[2020] UKSC 1', paragraphIds: ['c1'] },
    ])
    expect(computed.occurrences).toEqual([
      { paragraphId: 'c1', end: 19, citation: '[2020] UKSC 1' },
    ])
  })

  it('blocks a field draft whose only citation a pending style hides', () => {
    const anchor = paragraph('p2', 'text')
    const plan = planDocumentSave(
      model([paragraph('c1', 'Cited [2020] UKSC 1.'), anchor]),
      {
        ...emptyDraftState(),
        format: {
          ...emptyFormatDrafts,
          paragraphStyles: { c1: 'TableofAuthorities' },
        },
        structures: [
          {
            id: 's1',
            kind: 'table-of-authorities',
            paragraphId: 'p2',
            offset: 2,
          },
        ],
      },
    )
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toContain('no citations')
    expect(
      plan.operations.some(
        (operation) => operation.type === 'insert_table_of_authorities',
      ),
    ).toBe(false)
  })
})

describe('table-of-authorities refresh partition', () => {
  const storedField = () => [
    paragraph('c1', 'Cited [2020] UKSC 1.'),
    fieldHead('head'),
    fieldEntry('e1', '[2020] UKSC 1'),
    fieldTail('tail', 'rest'),
    paragraph('after'),
  ]

  it('keeps the refresh and emits the update operation', () => {
    const plan = planDocumentSave(model(storedField()), {
      ...emptyDraftState(),
      structures: [refreshDraft('s1', 'head')],
    })
    expect(plan.blocked).toEqual([])
    expect(plan.operations).toEqual([
      { type: 'update_table_of_authorities', paragraphId: 'head' },
    ])
    expect(plan.covered).toEqual([
      expect.objectContaining({ kind: 'structure', id: 's1' }),
    ])
  })

  it('blocks a refresh whose field is gone', () => {
    const plan = planDocumentSave(model([paragraph('p1'), paragraph('p2')]), {
      ...emptyDraftState(),
      structures: [refreshDraft('s1', 'head')],
    })
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]?.reason).toContain('no longer in the document')
    expect(plan.operations).toEqual([])
  })

  it('blocks a second refresh queued on the same field', () => {
    const plan = planDocumentSave(model(storedField()), {
      ...emptyDraftState(),
      structures: [refreshDraft('s1', 'head'), refreshDraft('s2', 'head')],
    })
    expect(plan.blocked).toHaveLength(1)
    expect(plan.blocked[0]?.reason).toContain('already queued')
    expect(plan.operations).toEqual([
      { type: 'update_table_of_authorities', paragraphId: 'head' },
    ])
  })

  it('blocks a refresh when typed text sits inside the covered range', () => {
    const plan = planDocumentSave(model(storedField()), {
      ...emptyDraftState(),
      drafts: { 'e1-r1': 'retyped' },
      structures: [refreshDraft('s1', 'head')],
    })
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toContain('Pending edits')
    expect(plan.operations).toEqual([
      { type: 'replace_run_text', runId: 'e1-r1', text: 'retyped' },
    ])
  })

  it('blocks a structure anchored inside a kept refresh range', () => {
    const plan = planDocumentSave(model(storedField()), {
      ...emptyDraftState(),
      structures: [
        refreshDraft('s1', 'head'),
        {
          id: 's2',
          kind: 'image',
          paragraphId: 'e1',
          offset: 0,
          contentType: 'image/png',
          dataBase64: 'aGk=',
          widthPx: 1,
          heightPx: 1,
          name: 'dot',
        },
      ],
    })
    expect(plan.blocked.map((item) => item.slot)).toEqual([
      expect.objectContaining({ id: 's2' }),
    ])
    expect(plan.blocked[0]?.reason).toContain('already queued to update')
    expect(plan.operations).toEqual([
      { type: 'update_table_of_authorities', paragraphId: 'head' },
    ])
  })

  it('blocks a refresh when the tail is marked for deletion', () => {
    const plan = planDocumentSave(model(storedField()), {
      ...emptyDraftState(),
      deletedParagraphIds: ['tail'],
      structures: [refreshDraft('s1', 'head')],
    })
    expect(plan.blocked.map((item) => item.slot.kind)).toEqual(['structure'])
    expect(plan.blocked[0]?.reason).toContain('marked for deletion')
    expect(plan.operations).toEqual([
      { type: 'delete_paragraph', paragraphId: 'tail' },
    ])
  })
})

describe('table-of-authorities refresh fold', () => {
  it('replaces the generated wires and dedupes the stored mark', () => {
    const citing = citingWithMark('c1', '[2020] UKSC 1')
    const stored = model([
      citing,
      fieldHead('head'),
      fieldEntry('e1', '[2020] UKSC 1'),
      fieldTail('tail', 'rest'),
      paragraph('new', 'Also [2019] EWCA Civ 12.'),
    ])
    const painted = withStructuralDrafts(stored, [refreshDraft('s1', 'head')])
    const paragraphs = painted.stories[0]?.paragraphs ?? []
    // The stored head and entry wires are gone; the tail stays.
    expect(paragraphs.some((paragraph) => paragraph.id === 'head')).toBe(false)
    expect(paragraphs.some((paragraph) => paragraph.id === 'e1')).toBe(false)
    expect(paragraphs.some((paragraph) => paragraph.id === 'tail')).toBe(true)
    const heading = paragraphs.find(
      (paragraph) => paragraph.styleId === 'TOAHeading',
    )
    expect(heading).toBeDefined()
    expect(
      heading?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ),
    ).toBe(true)
    const entries = paragraphs.filter(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    expect(entries.map((paragraph) => paragraphPlainText(paragraph))).toEqual([
      '[2019] EWCA Civ 12',
      '[2020] UKSC 1',
    ])
    // The stored mark is not duplicated: the citing wire still carries
    // exactly one `TA` instruction for the citation.
    const paintedCiting = paragraphs.find((paragraph) => paragraph.id === 'c1')
    const marks = (paintedCiting?.runs ?? []).filter((run) =>
      run.preservedXmlFragments.join('').includes(' TA \\l "'),
    )
    expect(marks).toHaveLength(1)
    // The new citation gets its own mark.
    const paintedNew = paragraphs.find((paragraph) => paragraph.id === 'new')
    expect(
      (paintedNew?.runs ?? []).some((run) =>
        run.preservedXmlFragments
          .join('')
          .includes(' TA \\l "[2019] EWCA Civ 12"'),
      ),
    ).toBe(true)
  })
})

describe('table of authorities update ribbon', () => {
  const toolbar = (
    paragraphs: DocumentParagraphWire[],
    paragraphId: string | null,
    structures: StructuralDraft[] = [],
  ) => {
    const stored = model(paragraphs)
    const api = documentStructureToolbar({
      paragraphId,
      model: stored,
      painted: stored,
      cellParagraphIds: new Set<string>(),
      offset: 0,
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
        structures.push(...update(structures))
      },
      toaFacts: facts(paragraphs),
    })
    return { api, structures }
  }

  it('offers the update when the caret sits inside a stored field', () => {
    const { api, structures } = toolbar(
      [
        paragraph('c1', 'Cited [2020] UKSC 1.'),
        fieldHead('head'),
        fieldEntry('e1', '[2020] UKSC 1'),
        fieldTail('tail', 'rest'),
      ],
      'e1',
    )
    expect(api.tableOfAuthoritiesUpdateUnavailable).toBeUndefined()
    expect(api.updateTableOfAuthorities()).toEqual({ inserted: true })
    expect(structures).toEqual([
      {
        id: structures[0]?.id ?? '',
        kind: 'table-of-authorities-refresh',
        paragraphId: 'head',
      },
    ])
  })

  it('refuses when the caret is outside every field', () => {
    const { api } = toolbar([paragraph('p1', 'text')], 'p1')
    expect(api.tableOfAuthoritiesUpdateUnavailable).toContain(
      'Place the cursor in a table of authorities',
    )
    expect(api.updateTableOfAuthorities().inserted).toBe(false)
  })

  it('refuses a second update already queued on the field', () => {
    const held: StructuralDraft[] = [refreshDraft('s1', 'head')]
    const { api } = toolbar(
      [
        paragraph('c1', 'Cited [2020] UKSC 1.'),
        fieldHead('head'),
        fieldEntry('e1', '[2020] UKSC 1'),
        fieldTail('tail', 'rest'),
      ],
      'head',
      held,
    )
    expect(api.tableOfAuthoritiesUpdateUnavailable).toContain(
      'already queued to update',
    )
  })
})
