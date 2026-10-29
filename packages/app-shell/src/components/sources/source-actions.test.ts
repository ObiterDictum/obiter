import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { CitationTarget } from '@obiter/contracts'
import { citationTargetRefusal, sourceCitation } from './SourceActions'

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function target(overrides: Partial<CitationTarget> = {}): CitationTarget {
  return {
    documentId: 'doc_1',
    matterId: 'mtr_1',
    matterName: 'Northgate Foods v Brightwater Packaging',
    filename: 'advice.docx',
    fileType: DOCX,
    openedAt: '2026-10-29T10:00:00.000Z',
    canEdit: true,
    ...overrides,
  }
}

describe('sourceCitation', () => {
  it('writes a judgment as its name and neutral citation', () => {
    expect(
      sourceCitation({
        kind: 'judgment',
        sourceId: 'uksc/2017/24',
        title: 'Wood v Capita Insurance Services Ltd',
        citation: '[2017] UKSC 24',
        sourceUrl: null,
      }),
    ).toBe('Wood v Capita Insurance Services Ltd [2017] UKSC 24')
  })

  it('writes a provision as its Act and section', () => {
    expect(
      sourceCitation({
        kind: 'legislation',
        sourceId: 'ukpga/2010/15/section/13/3',
        title: 'Equality Act 2010',
        citation: 's. 13(3)',
        sourceUrl: null,
      }),
    ).toBe('Equality Act 2010, s. 13(3)')
  })

  it('falls back to the title when the source carries no citation', () => {
    expect(
      sourceCitation({
        kind: 'judgment',
        sourceId: 'uksc/2017/24',
        title: 'Wood v Capita Insurance Services Ltd',
        citation: null,
        sourceUrl: null,
      }),
    ).toBe('Wood v Capita Insurance Services Ltd')
  })
})

describe('citationTargetRefusal', () => {
  it('offers an editable Word document', () => {
    expect(citationTargetRefusal(target())).toBeNull()
  })

  it('refuses a document the person may only view, and says why', () => {
    expect(citationTargetRefusal(target({ canEdit: false }))).toBe(
      'You have view-only access to this matter',
    )
  })

  it('refuses a format the editor cannot write', () => {
    expect(citationTargetRefusal(target({ fileType: 'application/pdf' }))).toBe(
      'PDF documents open read-only',
    )
    expect(citationTargetRefusal(target({ fileType: '.txt' }))).toBe(
      'Text documents open read-only',
    )
  })
})
