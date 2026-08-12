import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { collectEditOperations, isDraftDirty } from './document-edits'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
}

describe('collectEditOperations', () => {
  it('emits replace then insert, and skips run edits on deleted paragraphs', () => {
    expect(
      collectEditOperations(
        model,
        { r1: 'Hello world' },
        [{ clientId: 'local_1', afterParagraphId: 'p1', text: 'Next' }],
        [],
      ),
    ).toEqual([
      { type: 'replace_run_text', runId: 'r1', text: 'Hello world' },
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        text: 'Next',
      },
    ])
    expect(
      collectEditOperations(model, { r1: 'Hello world' }, [], ['p1']),
    ).toEqual([{ type: 'delete_paragraph', paragraphId: 'p1' }])
  })

  it('skips unchanged run text and does not treat identical drafts as dirty', () => {
    expect(collectEditOperations(model, { r1: 'Hello' }, [], [])).toEqual([])
    expect(isDraftDirty(model, { r1: 'Hello' }, [], [])).toBe(false)
    expect(isDraftDirty(model, { r1: 'Hello world' }, [], [])).toBe(true)
  })
})
