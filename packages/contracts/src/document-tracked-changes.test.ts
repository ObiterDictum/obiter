import { describe, expect, it } from 'vitest'

import {
  documentTrackedChangeDecisionRequestSchema,
  documentTrackedChangeListResponseSchema,
} from './document-tracked-changes'

const change = {
  id: 'change-000001',
  kind: 'move' as const,
  elementName: 'moveFrom' as const,
  direction: 'from' as const,
  ooxmlId: '001',
  pairId: 'change-000002',
  author: 'Reviewer',
  date: 'foreign-date',
  storyPartName: 'word/header1.xml',
  paragraphId: 'para-1',
  text: 'Moved text',
}

describe('tracked change contracts', () => {
  it('uses the shared exact change shape in the list response', () => {
    expect(
      documentTrackedChangeListResponseSchema.parse({
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        changes: [change],
      }),
    ).toMatchObject({ changes: [change] })
    expect(
      documentTrackedChangeListResponseSchema.safeParse({
        documentId: 'doc_1',
        versionId: 'ver_1',
        versionNumber: 1,
        changes: [{ ...change, sourceFragment: '<w:moveFrom/>' }],
      }).success,
    ).toBe(false)
  })

  it('accepts a bounded unique decision and rejects duplicates or extra fields', () => {
    expect(
      documentTrackedChangeDecisionRequestSchema.parse({
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['change-1', 'change-2'],
      }),
    ).toBeDefined()
    expect(
      documentTrackedChangeDecisionRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        action: 'reject',
        changeIds: ['change-1', 'change-1'],
      }).success,
    ).toBe(false)
    expect(
      documentTrackedChangeDecisionRequestSchema.safeParse({
        baseVersionId: 'ver_1',
        action: 'accept',
        changeIds: ['change-1'],
        author: 'client-controlled',
      }).success,
    ).toBe(false)
  })
})
