import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  emptyDraftState,
  isPendingBaselineId,
  planDocumentSave,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'
import {
  hasUnresolvedBaselineIdentities,
  lineageCoversCoveredSlots,
  remapLiveDraftState,
  resolveBaselineIdentities,
  translateSnapshot,
  type SaveBaseline,
} from './document-history-baseline'

function model(
  paragraphs: Array<{ id: string; run: string; text: string }>,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphs.map(({ id, run, text }) => ({
          id,
          runs: [{ id: run, text, preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        })),
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }
}

const fromModel = model([
  { id: 'p1', run: 'r1', text: 'Hello' },
  { id: 'p2', run: 'r2', text: 'tail' },
])

// What the server returns after saving: re-parsed identities, and the inserted
// paragraph named p3.
const savedModel = model([
  { id: 'p1', run: 'r1', text: 'Hello' },
  { id: 'p3', run: 'r3', text: 'Second' },
  { id: 'p2', run: 'r2', text: 'tail' },
])

function baseline(overrides: Partial<SaveBaseline>): SaveBaseline {
  return {
    covered: [],
    sent: emptyDraftState(),
    fromModel,
    ...overrides,
  }
}

// Authoritative lineage for saving an insert of 'Second' after p1.
const insertLineage: DocumentVersionLineage = {
  version: 1,
  baseVersionId: 'ver_1',
  versionId: 'ver_2',
  acceptedOperations: [0],
  paragraphs: [
    {
      fromParagraphId: 'p1',
      toParagraphId: 'p1',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 5 }],
        },
      ],
    },
    {
      fromParagraphId: null,
      toParagraphId: 'p3',
      insertedByOperation: 0,
      insertedByIntent: 'i1',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: null, fromOffset: 0, toOffset: 0 }],
        },
      ],
    },
    {
      fromParagraphId: 'p2',
      toParagraphId: 'p2',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'r2', fromOffset: 0, toOffset: 4 }],
        },
      ],
    },
  ],
}

// Authoritative lineage for saving a deletion of the first paragraph.
const firstDeleteLineage: DocumentVersionLineage = {
  version: 1,
  baseVersionId: 'ver_1',
  versionId: 'ver_2',
  acceptedOperations: [0],
  paragraphs: [
    { fromParagraphId: 'para-000001', toParagraphId: null, runs: [] },
    {
      fromParagraphId: 'para-000002',
      toParagraphId: 'para-w14-00000002',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'text-000002', fromOffset: 0, toOffset: 4 }],
        },
      ],
    },
    {
      fromParagraphId: 'para-000003',
      toParagraphId: 'para-w14-00000003',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'text-000003', fromOffset: 0, toOffset: 5 }],
        },
      ],
    },
  ],
}

const firstDeleteResult = model([
  { id: 'para-w14-00000002', run: 'text-000002', text: 'Beta' },
  { id: 'para-w14-00000003', run: 'text-000003', text: 'Gamma' },
])

// Authoritative lineage for saving a deletion of p2.
const deleteLineage: DocumentVersionLineage = {
  version: 1,
  baseVersionId: 'ver_1',
  versionId: 'ver_2',
  acceptedOperations: [0],
  paragraphs: [
    {
      fromParagraphId: 'p1',
      toParagraphId: 'p1',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 5 }],
        },
      ],
    },
    { fromParagraphId: 'p2', toParagraphId: null, runs: [] },
  ],
}

function runTextSlot(runId: string): DraftSlot {
  return { kind: 'run-text', key: `run:${runId}`, runId }
}

function insertSlot(clientId: string): DraftSlot {
  return { kind: 'insert', key: `insert:${clientId}`, clientId }
}

function deleteSlot(paragraphId: string): DraftSlot {
  return { kind: 'delete', key: `delete:${paragraphId}`, paragraphId }
}

describe('translateSnapshot', () => {
  it('re-expresses a pre-edit snapshot as an override on the saved run', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [runTextSlot('r1')],
      sent,
      fromModel,
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [0],
        paragraphs: [
          {
            fromParagraphId: 'p1',
            toParagraphId: 'p1',
            runs: [
              {
                runIndex: 0,
                segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 5 }],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
      toModel: model([
        { id: 'p1', run: 'r1', text: 'Hello world' },
        { id: 'p2', run: 'r2', text: 'tail' },
      ]),
    })
    // The snapshot described 'Hello'; against the saved model that is now an
    // override, so undo reverses the saved edit instead of doing nothing.
    expect(translated?.drafts).toEqual({ r1: 'Hello' })
  })

  it('distributes a pre-save run text across every result run continuing it', () => {
    // A mid-run structure splice split r1 into head + insert + tail while the
    // same save covered its text edit. The reversal must write each
    // continuing run's own slice: writing the whole pre-save text to the head
    // alone leaves the tail's saved text beside it, and the next save
    // persists the duplication.
    const splitResult = model([{ id: 'p1', run: 'head', text: 'Hello' }])
    splitResult.stories[0]?.paragraphs[0]?.runs.push(
      { id: 'inserted', text: '', preservedXmlFragments: [] },
      { id: 'tail', text: ' world typed more', preservedXmlFragments: [] },
    )
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world typed more' },
    }
    const translated = translateSnapshot(
      { ...emptyDraftState(), drafts: { r1: 'Hello world typed' } },
      {
        covered: [runTextSlot('r1')],
        sent,
        fromModel,
        toModel: splitResult,
        lineage: {
          version: 1,
          baseVersionId: 'ver_1',
          versionId: 'ver_2',
          acceptedOperations: [0, 1],
          paragraphs: [
            {
              fromParagraphId: 'p1',
              toParagraphId: 'p1',
              runs: [
                {
                  runIndex: 0,
                  segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 5 }],
                },
                {
                  runIndex: 1,
                  segments: [{ fromRunId: null, fromOffset: 0, toOffset: 0 }],
                },
                {
                  runIndex: 2,
                  segments: [{ fromRunId: 'r1', fromOffset: 5, toOffset: 22 }],
                },
              ],
            },
          ],
        },
        versionId: 'ver_2',
      },
    )
    expect(translated?.drafts).toEqual({
      head: 'Hello',
      tail: ' world typed',
    })
  })

  it('restates a saved run emphasis on every run a splice produced', () => {
    const from = model([{ id: 'p1', run: 'r1', text: 'Hello world' }])
    const run = from.stories[0]?.paragraphs[0]?.runs[0]
    if (run) {
      run.preservedXmlFragments = [
        '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/></w:rPr>',
      ]
    }
    const splitResult = model([{ id: 'p1', run: 'head', text: 'Hello' }])
    splitResult.stories[0]?.paragraphs[0]?.runs.push(
      { id: 'inserted', text: '', preservedXmlFragments: [] },
      { id: 'tail', text: ' world typed more', preservedXmlFragments: [] },
    )
    const sent: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyDraftState().format,
        emphasis: [{ runId: 'r1', bold: true }],
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [{ kind: 'emphasis', key: 'emph:run:r1' }],
      sent,
      fromModel: from,
      toModel: splitResult,
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [0],
        paragraphs: [
          {
            fromParagraphId: 'p1',
            toParagraphId: 'p1',
            runs: [
              {
                runIndex: 0,
                segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 5 }],
              },
              {
                runIndex: 1,
                segments: [{ fromRunId: null, fromOffset: 0, toOffset: 0 }],
              },
              {
                runIndex: 2,
                segments: [{ fromRunId: 'r1', fromOffset: 5, toOffset: 11 }],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
    })
    // The saved rPr was copied to both halves of the split run, so the
    // inverse is restated on each — or the tail keeps the saved styling.
    expect(translated?.format.emphasis.map((item) => item.runId)).toEqual([
      'head',
      'tail',
    ])
  })

  it('drops a covered override a snapshot no longer holds', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const translated = translateSnapshot(
      { ...emptyDraftState(), drafts: { r1: 'Hello world' } },
      { covered: [runTextSlot('r1')], sent, fromModel },
    )
    expect(translated?.drafts).toEqual({})
  })

  it('turns a pre-insert snapshot into a deletion of the stored paragraph', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [insertSlot('i1')],
      sent,
      fromModel,
      toModel: savedModel,
      lineage: insertLineage,
      versionId: 'ver_2',
    })
    expect(translated?.inserts).toEqual([])
    expect(translated?.deletedParagraphIds).toEqual(['p3'])
  })

  it('turns a live-insert snapshot into a text override on the stored paragraph', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(
      {
        ...emptyDraftState(),
        inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
      },
      {
        covered: [insertSlot('i1')],
        sent,
        fromModel,
        toModel: savedModel,
        lineage: insertLineage,
        versionId: 'ver_2',
      },
    )
    expect(translated?.inserts).toEqual([])
    expect(translated?.drafts).toEqual({ r3: '' })
  })

  it('holds an inserted run override as a pending identity until the model loads', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const boundary = baseline({
      covered: [insertSlot('i1')],
      sent,
      lineage: insertLineage,
      versionId: 'ver_2',
    })
    const translated = translateSnapshot(
      {
        ...emptyDraftState(),
        inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
      },
      boundary,
    )
    // The paragraph id is authoritative from the lineage; only the result run
    // id waits for the reloaded model, so it is held as a pending identity.
    const heldRun = Object.keys(translated?.drafts ?? {})[0] ?? ''
    expect(isPendingBaselineId(heldRun)).toBe(true)

    const resolved = resolveBaselineIdentities(
      translated ?? emptyDraftState(),
      { ...boundary, toModel: savedModel },
    )
    expect(resolved.drafts).toEqual({ r3: '' })
  })

  it('rebuilds a saved deletion as an insert after its surviving neighbour', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p2'],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [deleteSlot('p2')],
      sent,
      fromModel,
      toModel: model([{ id: 'p1', run: 'r1', text: 'Hello' }]),
      lineage: deleteLineage,
      versionId: 'ver_2',
    })
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.inserts).toHaveLength(1)
    expect(translated?.inserts[0]?.afterParagraphId).toBe('p1')
    expect(translated?.inserts[0]?.text).toBe('tail')
  })

  it('drops the mask a snapshot already holds for a saved deletion', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p2'],
    }
    const translated = translateSnapshot(
      { ...emptyDraftState(), deletedParagraphIds: ['p2'] },
      {
        covered: [deleteSlot('p2')],
        sent,
        fromModel,
        toModel: model([{ id: 'p1', run: 'r1', text: 'Hello' }]),
      },
    )
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.inserts).toEqual([])
  })

  it('returns null when a saved deletion has no surviving anchor to restore after', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p1'],
    }
    expect(
      translateSnapshot(emptyDraftState(), {
        covered: [deleteSlot('p1')],
        sent,
        fromModel,
        toModel: model([{ id: 'p2', run: 'r2', text: 'tail' }]),
      }),
    ).toBeNull()
  })

  it('never leaves a covered slot replayable after translation', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const snapshot: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(snapshot, {
      covered: [runTextSlot('r1'), insertSlot('i1')],
      sent,
      fromModel,
      toModel: savedModel,
    })
    const plan = planDocumentSave(savedModel, translated ?? emptyDraftState())
    expect(
      plan.operations.some(
        (operation) => operation.type === 'insert_paragraph_after',
      ),
    ).toBe(false)
  })

  it('reverses a saved section change by restating the pre-save section', () => {
    const sectioned = model([{ id: 'p1', run: 'r1', text: 'Hello' }])
    const story = sectioned.stories[0]
    if (story) {
      story.preservedXmlFragments = [
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      ]
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyDraftState().format,
        section: { margins: { top: 720 } },
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [{ kind: 'section', key: 'section' }],
      sent,
      fromModel: sectioned,
    })
    expect(translated?.format.section).toEqual({
      margins: {
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
        header: null,
        footer: null,
        gutter: null,
      },
    })
  })

  it('translates a saved break the way a non-removable structure does', () => {
    const breakSlot: DraftSlot = {
      kind: 'break',
      key: 'break:b1',
      id: 'b1',
      breakKind: 'page',
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      breaks: [{ id: 'b1', paragraphId: 'p1', offset: 0, kind: 'page' }],
    }
    // The snapshot holds the break as pending work, but the save stored it,
    // so the snapshot already describes the saved document: the covered slot
    // drops and unrelated work in the same snapshot survives. Blocking here
    // wedged the workspace — every later edit painted but could never save.
    const held = translateSnapshot(
      { ...sent, drafts: { r1: 'Typed' } },
      { covered: [breakSlot], sent, fromModel },
    )
    expect(held).not.toBeNull()
    expect(held?.breaks).toEqual([])
    expect(held?.drafts.r1).toBe('Typed')
    // A snapshot that predates the break drops the covered slot and does not
    // block: it already describes the document without the break.
    const pre = translateSnapshot(emptyDraftState(), {
      covered: [breakSlot],
      sent,
      fromModel,
    })
    expect(pre).not.toBeNull()
    expect(pre?.breaks).toEqual([])
  })

  it('translates a snapshot holding a pending break and structure together', () => {
    // The E7c defect shape: the break and the field were both pending in one
    // save, and the snapshot taken between them held both. A page break and a
    // section break share the 'break' slot kind, so one covered break of each
    // kind pins the neighbour combinations too.
    const covered: DraftSlot[] = [
      { kind: 'break', key: 'break:b1', id: 'b1', breakKind: 'page' },
      { kind: 'break', key: 'break:b2', id: 'b2', breakKind: 'section' },
      {
        kind: 'structure',
        key: 'structure:s1',
        id: 's1',
        structureKind: 'table-of-contents',
      },
    ]
    const sent: DraftState = {
      ...emptyDraftState(),
      breaks: [
        { id: 'b1', paragraphId: 'p1', offset: 0, kind: 'page' },
        { id: 'b2', paragraphId: 'p2', offset: 0, kind: 'section' },
      ],
      structures: [
        {
          id: 's1',
          kind: 'table-of-contents',
          paragraphId: 'p1',
          offset: 0,
        },
      ],
    }
    const held = translateSnapshot(
      {
        ...sent,
        drafts: { r1: 'Typed' },
      },
      { covered, sent, fromModel },
    )
    expect(held).not.toBeNull()
    expect(held?.breaks).toEqual([])
    expect(held?.structures).toEqual([])
    expect(held?.drafts.r1).toBe('Typed')
  })
})

/**
 * The authoritative lineage is the identity source. These cases are the
 * reviewer's wrong-target reproduction in miniature: a mid-document insert
 * whose result positions shift cannot be resolved by an id set-difference, but
 * the server names the stored paragraph directly.
 */
describe('lineage-driven identity', () => {
  const baseModel = model([
    { id: 'para-000001', run: 'text-000001', text: 'Alpha' },
    { id: 'para-000002', run: 'text-000002', text: 'Beta' },
    { id: 'para-000003', run: 'text-000003', text: 'Gamma' },
  ])
  const resultModel = model([
    { id: 'para-w14-00000001', run: 'text-000001', text: 'Alpha' },
    { id: 'para-w14-00000002', run: 'text-000002', text: 'Inserted' },
    { id: 'para-w14-00000003', run: 'text-000003', text: 'Beta' },
    { id: 'para-w14-00000004', run: 'text-000004', text: 'Gamma' },
  ])
  const lineage: DocumentVersionLineage = {
    version: 1,
    baseVersionId: 'ver_1',
    versionId: 'ver_2',
    acceptedOperations: [0],
    paragraphs: [
      {
        fromParagraphId: 'para-000001',
        toParagraphId: 'para-w14-00000001',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000001', fromOffset: 0, toOffset: 5 },
            ],
          },
        ],
      },
      {
        fromParagraphId: null,
        toParagraphId: 'para-w14-00000002',
        insertedByOperation: 0,
        insertedByIntent: 'c1',
        runs: [
          {
            runIndex: 0,
            segments: [{ fromRunId: null, fromOffset: 0, toOffset: 0 }],
          },
        ],
      },
      {
        fromParagraphId: 'para-000002',
        toParagraphId: 'para-w14-00000003',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000002', fromOffset: 0, toOffset: 4 },
            ],
          },
        ],
      },
      {
        fromParagraphId: 'para-000003',
        toParagraphId: 'para-w14-00000004',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000003', fromOffset: 0, toOffset: 5 },
            ],
          },
        ],
      },
    ],
  }

  it('deletes the paragraph the save inserted, not the tail', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [
        { clientId: 'c1', afterParagraphId: 'para-000001', text: 'Inserted' },
      ],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [insertSlot('c1')],
      sent,
      fromModel: baseModel,
      toModel: resultModel,
      lineage,
      versionId: 'ver_2',
    })
    // The snapshot predates the insert, so its reversal deletes exactly the
    // stored paragraph. Gamma (para-000003) must not be touched.
    expect(translated?.deletedParagraphIds).toEqual(['para-w14-00000002'])
    expect(translated?.deletedParagraphIds).not.toContain('para-w14-00000004')
  })

  it('retargets a covered run-text reversal to the result run id', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000003': 'Gamma edited' },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [runTextSlot('text-000003')],
      sent,
      fromModel: baseModel,
      toModel: resultModel,
      lineage,
      versionId: 'ver_2',
    })
    expect(translated?.drafts).toEqual({ 'text-000004': 'Gamma' })
  })

  it('restores a saved first-paragraph deletion before the first survivor', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['para-000001'],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [deleteSlot('para-000001')],
      sent,
      fromModel: baseModel,
      toModel: firstDeleteResult,
      lineage: firstDeleteLineage,
      versionId: 'ver_2',
    })
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.inserts).toHaveLength(1)
    expect(translated?.inserts[0]?.beforeParagraphId).toBe('para-w14-00000002')
    expect(translated?.inserts[0]?.afterParagraphId).toBe('para-w14-00000002')
    expect(translated?.inserts[0]?.text).toBe('Alpha')
    expect(translated?.inserts[0]?.runs?.[0]?.text).toBe('Alpha')
  })

  it('keeps the restored first paragraph style on the insert', () => {
    const styled = model([
      { id: 'para-000001', run: 'text-000001', text: 'Alpha' },
      { id: 'para-000002', run: 'text-000002', text: 'Beta' },
    ])
    const first = styled.stories[0]?.paragraphs[0]
    if (first) first.styleId = 'Heading1'
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [deleteSlot('para-000001')],
      sent: { ...emptyDraftState(), deletedParagraphIds: ['para-000001'] },
      fromModel: styled,
      toModel: model([
        { id: 'para-w14-00000002', run: 'text-000002', text: 'Beta' },
      ]),
      lineage: firstDeleteLineage,
      versionId: 'ver_2',
    })
    const clientId = translated?.inserts[0]?.clientId ?? ''
    expect(translated?.format.paragraphStyles[clientId]).toBe('Heading1')
  })

  it('reverses a saved numbering change at the result paragraph', () => {
    const numbered = model([
      { id: 'para-000001', run: 'text-000001', text: 'List item' },
    ])
    const paragraph = numbered.stories[0]?.paragraphs[0]
    if (paragraph) {
      paragraph.preservedXmlFragments = [
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
      ]
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyDraftState().format,
        numbering: { 'para-000001': { numId: '2', ilvl: 0 } },
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [
        {
          kind: 'numbering',
          key: 'number:para-000001',
          paragraphId: 'para-000001',
        },
      ],
      sent,
      fromModel: numbered,
      toModel: model([
        { id: 'para-w14-00000001', run: 'text-000001', text: 'List item' },
      ]),
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [0],
        paragraphs: [
          {
            fromParagraphId: 'para-000001',
            toParagraphId: 'para-w14-00000001',
            runs: [
              {
                runIndex: 0,
                segments: [
                  { fromRunId: 'text-000001', fromOffset: 0, toOffset: 9 },
                ],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
    })
    expect(translated?.format.numbering).toEqual({
      'para-w14-00000001': { numId: '1', ilvl: 0 },
    })
  })

  it('restates the pre-save font properties when undoing a saved change', () => {
    const from = model([
      { id: 'para-000001', run: 'text-000001', text: 'Clause' },
    ])
    const run = from.stories[0]?.paragraphs[0]?.runs[0]
    if (run) {
      run.preservedXmlFragments = [
        '<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="28"/><w:color w:val="FF0000"/><w:smallCaps/></w:rPr>',
      ]
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      format: {
        ...emptyDraftState().format,
        emphasis: [
          {
            runId: 'text-000001',
            fontFamily: 'Arial',
            fontSize: 24,
            colour: '00FF00',
            smallCaps: false,
          },
        ],
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [{ kind: 'emphasis', key: 'emph:run:text-000001' }],
      sent,
      fromModel: from,
      toModel: model([
        { id: 'para-w14-00000001', run: 'text-w14-00000001', text: 'Clause' },
      ]),
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [0],
        paragraphs: [
          {
            fromParagraphId: 'para-000001',
            toParagraphId: 'para-w14-00000001',
            runs: [
              {
                runIndex: 0,
                segments: [
                  { fromRunId: 'text-000001', fromOffset: 0, toOffset: 6 },
                ],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
    })
    // The reversal must carry the whole pre-save character state, or the saved
    // font properties survive the undo.
    expect(translated?.format.emphasis).toEqual([
      {
        runId: 'text-w14-00000001',
        bold: null,
        italic: null,
        underline: null,
        strikethrough: null,
        fontFamily: 'Georgia',
        fontSize: 28,
        colour: 'FF0000',
        highlight: null,
        vertAlign: null,
        smallCaps: true,
      },
    ])
  })

  it('reverses a saved join by restoring the last original run text', () => {
    const from = model([
      { id: 'para-000001', run: 'text-000001', text: 'Hello' },
    ])
    const sent: DraftState = {
      ...emptyDraftState(),
      extraRuns: {
        'para-000001': [{ id: 'x', text: 'World', preservedXmlFragments: [] }],
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [
        {
          kind: 'extra-runs',
          key: 'extra:para-000001',
          paragraphId: 'para-000001',
        },
      ],
      sent,
      fromModel: from,
      toModel: model([
        { id: 'para-w14-00000001', run: 'text-000001', text: 'HelloWorld' },
      ]),
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [0],
        paragraphs: [
          {
            fromParagraphId: 'para-000001',
            toParagraphId: 'para-w14-00000001',
            runs: [
              {
                runIndex: 0,
                segments: [
                  { fromRunId: 'text-000001', fromOffset: 0, toOffset: 5 },
                ],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
    })
    expect(translated?.drafts).toEqual({ 'text-000001': 'Hello' })
    expect(translated?.extraRuns).toEqual({})
  })

  it('never keeps a source run id when the lineage cannot address it', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000001': 'Hello world' },
    }
    const noRunAddresses: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [],
    }
    // The boundary is refused before any translation happens.
    expect(
      lineageCoversCoveredSlots(noRunAddresses, {
        covered: [runTextSlot('text-000001')],
        sent,
        fromModel: baseModel,
      }),
    ).toBe(false)
    // Defence in depth: even a direct translation must not produce a draft
    // keyed by the source run id, which post-reload names unrelated content.
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [runTextSlot('text-000001')],
      sent,
      fromModel: baseModel,
      lineage: noRunAddresses,
      versionId: 'ver_2',
    })
    expect(Object.keys(translated?.drafts ?? {})).not.toContain('text-000001')
    expect(
      hasUnresolvedBaselineIdentities(translated ?? emptyDraftState()),
    ).toBe(true)
  })

  it('surfaces an uncovered base run the lineage does not name', () => {
    // A run the batch did not cover still names a base identity. If the
    // lineage omits its result address, keeping the base id would retarget it.
    const state: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000002': 'typed late' },
    }
    const lineageWithoutBeta: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [
        {
          fromParagraphId: 'para-000001',
          toParagraphId: 'para-w14-00000001',
          runs: [
            {
              runIndex: 0,
              segments: [
                { fromRunId: 'text-000001', fromOffset: 0, toOffset: 5 },
              ],
            },
          ],
        },
      ],
    }
    const result = remapLiveDraftState(state, {
      covered: [],
      sent: emptyDraftState(),
      fromModel: baseModel,
      lineage: lineageWithoutBeta,
      versionId: 'ver_2',
      toModel: resultModel,
    })
    expect(result.unresolved).toBe(true)
    // The base key is left explicit as unsaved work, never silently sent.
    expect(Object.keys(result.state.drafts)).toContain('text-000002')
  })

  it('refuses a boundary whose lineage carries no address for the run', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000001': 'Hello world' },
    }
    // A tracked version omits every run address, so a covered run-keyed
    // reversal cannot be translated and the boundary is refused, not guessed.
    const uncovered: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [
        {
          fromParagraphId: 'para-000001',
          toParagraphId: 'para-w14-00000001',
          runs: [],
        },
      ],
    }
    expect(
      lineageCoversCoveredSlots(uncovered, {
        covered: [runTextSlot('text-000001')],
        sent,
        fromModel: baseModel,
      }),
    ).toBe(false)
    // The lineage that maps the run is accepted.
    expect(
      lineageCoversCoveredSlots(lineage, {
        covered: [runTextSlot('text-000001')],
        sent,
        fromModel: baseModel,
      }),
    ).toBe(true)
  })

  it('translates a tracked insertion into a rejection plus shell removal', () => {
    const trackedInsertLineage: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [
        {
          fromParagraphId: null,
          toParagraphId: 'para-w14-00000002',
          insertedByOperation: 0,
          insertedByIntent: 'i1',
          trackedInsertChangeIds: ['0'],
          runs: [],
        },
      ],
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Inserted' }],
    }
    const boundary: SaveBaseline = {
      covered: [insertSlot('i1')],
      sent,
      fromModel,
      lineage: trackedInsertLineage,
      versionId: 'ver_2',
    }
    // The covered insertion parses to no run, but its reversal is named, so
    // the boundary is accepted rather than blocked.
    expect(lineageCoversCoveredSlots(trackedInsertLineage, boundary)).toBe(true)
    const translated = translateSnapshot(emptyDraftState(), boundary)
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.trackedRejections).toEqual([
      {
        key: 'reject:0',
        ooxmlIds: ['0'],
        removeParagraphIds: ['para-w14-00000002'],
      },
    ])
  })

  it('translates a tracked replacement into a rejection group, not a run id', () => {
    const trackedLineage: DocumentVersionLineage = {
      version: 1,
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
      acceptedOperations: [0],
      paragraphs: [
        {
          fromParagraphId: 'para-000001',
          toParagraphId: 'para-w14-00000001',
          runs: [],
        },
      ],
      reversals: [
        {
          operation: 0,
          fromRunId: 'text-000001',
          fromParagraphId: 'para-000001',
          rejectOoxmlIds: ['0', '1'],
        },
      ],
    }
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000001': 'Alpha changed' },
    }
    const snapshot: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000001': 'Alpha' },
    }
    const boundary: SaveBaseline = {
      covered: [runTextSlot('text-000001')],
      sent,
      fromModel: baseModel,
      lineage: trackedLineage,
      versionId: 'ver_2',
      toModel: resultModel,
    }
    // The covered run has no result address but a named rejection, so the
    // boundary is accepted rather than refused.
    expect(lineageCoversCoveredSlots(trackedLineage, boundary)).toBe(true)
    const translated = translateSnapshot(snapshot, boundary)
    // No run id is invented for content the model does not have; the reversal
    // is the persisted change group.
    expect(translated?.drafts['text-000001']).toBeUndefined()
    expect(translated?.trackedRejections).toEqual([
      { key: 'reject:0,1', ooxmlIds: ['0', '1'] },
    ])
    expect(
      hasUnresolvedBaselineIdentities(translated ?? emptyDraftState()),
    ).toBe(false)
  })

  it('remaps a live break draft to the canonical paragraph id', () => {
    const state: DraftState = {
      ...emptyDraftState(),
      breaks: [
        {
          id: 'b1',
          paragraphId: 'para-000001',
          offset: 0,
          kind: 'page',
        },
      ],
    }
    const result = remapLiveDraftState(state, {
      covered: [],
      sent: emptyDraftState(),
      fromModel: baseModel,
      lineage: {
        version: 1,
        baseVersionId: 'ver_1',
        versionId: 'ver_2',
        acceptedOperations: [],
        paragraphs: [
          {
            fromParagraphId: 'para-000001',
            toParagraphId: 'para-w14-00000001',
            runs: [
              {
                runIndex: 0,
                segments: [
                  { fromRunId: 'text-000001', fromOffset: 0, toOffset: 5 },
                ],
              },
            ],
          },
        ],
      },
      versionId: 'ver_2',
      toModel: resultModel,
    })
    expect(result.state.breaks).toEqual([
      { id: 'b1', paragraphId: 'para-w14-00000001', offset: 0, kind: 'page' },
    ])
  })
})
