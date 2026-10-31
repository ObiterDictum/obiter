import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphMeasure } from './document-page-measure'

const loadingDone: Array<() => void> = []
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: {
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'loadingdone') loadingDone.push(listener)
    },
  },
})

const paragraph: DocumentParagraphWire = {
  id: 'p1',
  runs: [
    {
      id: 'p1-r',
      text: 'The Claimant seeks damages for breach of clause 4.2.',
      preservedXmlFragments: [],
    },
  ],
  preservedXmlFragments: [],
}

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [paragraph],
      preservedXmlFragments: [],
      fields: [],
      unanchoredFieldParagraphIds: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
  comments: [],
  trackRevisions: false,
  markings: {
    documentKind: null,
    draft: false,
    privileged: false,
    withoutPrejudice: false,
  },
}

const measure = () => paragraphMeasure(paragraph, model, undefined, {})

describe('paragraph measure cache', () => {
  it('clears itself when web fonts finish loading', () => {
    const first = measure()
    expect(measure()).toBe(first)
    expect(loadingDone).toHaveLength(1)
    loadingDone[0]?.()
    expect(measure()).not.toBe(first)
  })
})
