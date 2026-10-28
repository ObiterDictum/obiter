import { describe, expect, it } from 'bun:test'
import type { MatterDocumentRecord } from '../documents'
import type { MatterRecord } from '../matters'
import type { AttentionItem } from './home-attention'
import {
  buildMatterRows,
  filterMatterRows,
  lastActivityOf,
  legalDomainOptions,
  openWorkByMatter,
} from './matters-rows'

function matter(overrides: Partial<MatterRecord> = {}): MatterRecord {
  return {
    id: 'mtr_1',
    organisationId: 'org_1',
    name: 'Northgate Foods v Brightwater Packaging',
    description: null,
    primaryJurisdiction: 'England & Wales',
    secondaryJurisdictions: [],
    legalDomains: ['Commercial contracts'],
    clientReference: 'NGF-0418',
    status: 'active',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  }
}

function document(id: string, updatedAt: string): MatterDocumentRecord {
  return {
    id,
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: `ver_${id}`,
    logicalKey: id,
    createdBy: 'usr_1',
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    deletedBy: null,
    currentVersion: {
      id: `ver_${id}`,
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: id,
      filename: `${id}.docx`,
      fileType: 'docx',
      sizeBytes: '1024',
      objectKey: `org/org_1/matters/mtr_1/documents/${id}/versions/1/source`,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber: 1,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: updatedAt,
      updatedAt,
    },
  }
}

function item(overrides: Partial<AttentionItem> & { id: string }) {
  return {
    kind: 'verify_flagged',
    runId: 'vrun_1',
    matterId: 'mtr_1',
    matterName: 'Northgate',
    matterReference: 'NGF-0418',
    documentId: 'doc_1',
    filename: 'advice-note.docx',
    waitingSince: '2026-10-25T09:00:00.000Z',
    flaggedCount: 1,
    reviewRequiredCount: 0,
    failureCode: null,
    ...overrides,
  } as AttentionItem
}

describe('matter row activity', () => {
  it('takes the newest document version as activity', () => {
    expect(
      lastActivityOf(matter(), [
        document('agreement', '2026-10-26T11:30:00.000Z'),
        document('advice', '2026-10-20T09:00:00.000Z'),
      ]),
    ).toBe('2026-10-26T11:30:00.000Z')
  })

  it('keeps the matter’s own change when documents are older or unread', () => {
    expect(lastActivityOf(matter(), undefined)).toBe('2026-10-01T00:00:00.000Z')
    expect(
      lastActivityOf(matter(), [document('old', '2026-09-01T00:00:00.000Z')]),
    ).toBe('2026-10-01T00:00:00.000Z')
  })

  it('orders matters by that activity, newest first', () => {
    const rows = buildMatterRows({
      matters: [
        matter({ id: 'mtr_old', updatedAt: '2026-05-01T00:00:00.000Z' }),
        matter({ id: 'mtr_new', updatedAt: '2026-10-01T00:00:00.000Z' }),
        matter({ id: 'mtr_docs', updatedAt: '2026-06-01T00:00:00.000Z' }),
      ],
      documentsByMatter: new Map([
        ['mtr_docs', [document('fresh', '2026-10-27T10:00:00.000Z')]],
      ]),
      openWork: new Map(),
    })
    expect(rows.map((row) => row.matter.id)).toEqual([
      'mtr_docs',
      'mtr_new',
      'mtr_old',
    ])
  })
})

describe('open work', () => {
  it('groups the queue’s items by matter and counts each kind', () => {
    const grouped = openWorkByMatter([
      item({ id: 'a' }),
      item({
        id: 'b',
        kind: 'verify_review',
        flaggedCount: 0,
        reviewRequiredCount: 2,
      }),
      item({ id: 'c', kind: 'redact_decision', matterId: 'mtr_2' }),
      item({ id: 'd', kind: 'verify_failed', matterId: null } as never),
    ])
    const first = grouped.get('mtr_1')
    if (!first) throw new Error('expected open work for the first matter')
    expect(first.total).toBe(2)
    // Findings, not rows: the flag and the two review-required citations.
    expect(first.flaggedFindings).toBe(1)
    expect(first.reviewFindings).toBe(2)
    expect(first.redactionDecisions).toBe(0)
    // An item with no matter (a run removed from its matter) is not attributed.
    expect(grouped.get('mtr_2')?.total).toBe(1)
  })

  it('leaves open work unknown until the runs have been read', () => {
    const [row] = buildMatterRows({
      matters: [matter()],
      documentsByMatter: new Map(),
      openWork: null,
    })
    if (!row) throw new Error('expected one row')
    expect(row.openWork).toBeNull()
    expect(row.documentCount).toBeNull()
  })
})

describe('filters', () => {
  const rows = buildMatterRows({
    matters: [
      matter({ id: 'mtr_1' }),
      matter({
        id: 'mtr_2',
        name: 'Okafor v Lumen Logistics',
        clientReference: 'OKA-0233',
        legalDomains: ['Employment'],
      }),
      matter({
        id: 'mtr_3',
        name: 'Lindqvist Estate',
        clientReference: 'LIN-0107',
        legalDomains: ['Private client'],
      }),
    ],
    documentsByMatter: new Map(),
    openWork: openWorkByMatter([item({ id: 'a' })]),
  })

  it('searches the fields the API returns', () => {
    const ids = (search: string) =>
      filterMatterRows(rows, {
        search,
        domain: null,
        needsAttention: false,
      }).map((row) => row.matter.id)
    expect(ids('okafor')).toEqual(['mtr_2'])
    expect(ids('OKA-0233')).toEqual(['mtr_2'])
    expect(ids('private client')).toEqual(['mtr_3'])
    expect(ids('england & wales')).toEqual(['mtr_1', 'mtr_2', 'mtr_3'])
    expect(ids('nothing here')).toEqual([])
  })

  it('filters by legal domain and by matters with open work', () => {
    expect(
      filterMatterRows(rows, {
        search: '',
        domain: 'Employment',
        needsAttention: false,
      }).map((row) => row.matter.id),
    ).toEqual(['mtr_2'])
    expect(
      filterMatterRows(rows, {
        search: '',
        domain: null,
        needsAttention: true,
      }).map((row) => row.matter.id),
    ).toEqual(['mtr_1'])
  })

  it('offers only the domains the matters actually use', () => {
    expect(legalDomainOptions(rows.map((row) => row.matter))).toEqual([
      'Commercial contracts',
      'Employment',
      'Private client',
    ])
  })
})
