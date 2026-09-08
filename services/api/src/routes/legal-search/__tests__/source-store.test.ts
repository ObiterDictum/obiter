import { describe, expect, it } from 'vitest'
import { createInMemoryLegalAuthoritySourceStore } from '../source-store'

const sourceProvider = {
  documentUri: '/uksc/2024/3',
  sourceUri: '/uksc/2024/3',
  xmlUri: null,
  pdfUri: null,
  contentHash: 'abc123',
  rawAtomEntry: '<entry />',
}

const storedAuthority = {
  id: 'uksc-2024-3',
  title: 'Potanina v Potanin',
  neutralCitation: '[2024] UKSC 3',
  court: 'uksc',
  jurisdiction: 'uk',
  dateDecided: '2024-01-31',
  sourceType: 'judgment' as const,
  sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/3',
  paragraphs: [
    {
      id: 'uksc-2024-3-p1',
      documentId: 'uksc-2024-3',
      paragraphNumber: 1,
      text: 'The judgment discusses a fiduciary appendix that is absent from summary metadata.',
    },
  ],
}

describe('legal authority source store', () => {
  it('reads stored summaries and documents back by id', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()

    await store.upsertDocument(storedAuthority, sourceProvider)

    const record = await store.get('uksc-2024-3')
    expect(record?.summary.id).toBe('uksc-2024-3')
    expect(record?.document?.paragraphs).toHaveLength(1)
    expect(record?.withdrawn).toBeUndefined()
    expect(await store.get('missing-id')).toBeNull()
  })

  it('keeps the summary when only a document is upserted later', async () => {
    const store = createInMemoryLegalAuthoritySourceStore()

    await store.upsertDocument(storedAuthority, sourceProvider)

    const record = await store.get('uksc-2024-3')
    expect(record?.summary.title).toBe('Potanina v Potanin')
  })
})
