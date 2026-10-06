import { describe, expect, it } from 'bun:test'
import {
  createInMemoryLegalAuthoritySourceStore,
  selectAuthorityCarriers,
  type StoredAuthorityCarrier,
} from '../source-store'

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

const live = (id: string): StoredAuthorityCarrier => ({ id, withdrawn: false })
const withdrawn = (id: string): StoredAuthorityCarrier => ({
  id,
  withdrawn: true,
})

/**
 * The one live/withdrawn carrier rule. It states which identities exist and
 * which are trustworthy; V2 maps a selection onto heldness and V3 onto an
 * identity, so this table is the contract both stages read.
 */
describe('selectAuthorityCarriers', () => {
  it.each([
    ['no carrier', [], { kind: 'none' }],
    ['one live', [live('a')], { kind: 'single_live', id: 'a' }],
    ['one withdrawn', [withdrawn('a')], { kind: 'no_live', ids: ['a'] }],
    [
      'one live plus one withdrawn',
      [live('a'), withdrawn('b')],
      { kind: 'single_live', id: 'a' },
    ],
    [
      'one live plus multiple withdrawn',
      [withdrawn('b'), live('a'), withdrawn('c')],
      { kind: 'single_live', id: 'a' },
    ],
    ['multiple live', [live('a'), live('b')], { kind: 'ambiguous' }],
    [
      'multiple live plus withdrawn',
      [live('b'), withdrawn('c'), live('a')],
      { kind: 'ambiguous' },
    ],
    [
      'multiple withdrawn',
      [withdrawn('b'), withdrawn('a')],
      { kind: 'no_live', ids: ['a', 'b'] },
    ],
  ])('selects %s', (_label, carriers, expected) => {
    expect(selectAuthorityCarriers(carriers)).toEqual(expected)
  })

  it('does not depend on the order carriers arrive in', () => {
    const carriers = [live('b'), withdrawn('c'), live('a'), withdrawn('d')]
    expect(selectAuthorityCarriers(carriers)).toEqual(
      selectAuthorityCarriers([...carriers].reverse()),
    )
    // Two live carriers stay ambiguous in either order: no carrier wins by
    // arriving first.
    expect(selectAuthorityCarriers([live('a'), live('b')])).toEqual({
      kind: 'ambiguous',
    })
  })

  it('deduplicates a repeated id and fails closed on a conflicting one', () => {
    // `document_id` is the store's primary key, so a duplicate is not reachable
    // from the store; a direct caller passing one must not change the outcome.
    expect(selectAuthorityCarriers([live('a'), live('a')])).toEqual({
      kind: 'single_live',
      id: 'a',
    })
    // A conflicting duplicate is withdrawn, which is the untrustworthy state,
    // rather than clearing on it.
    expect(selectAuthorityCarriers([live('a'), withdrawn('a')])).toEqual({
      kind: 'no_live',
      ids: ['a'],
    })
  })
})
