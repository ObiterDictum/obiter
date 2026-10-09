import { describe, expect, it } from 'bun:test'

import type { DocumentChangeWire, DocumentModelWire } from '@obiter/contracts'
import { rejectedShellParagraphIds } from './document-review'

const inserted = (id: string, paragraphId: string): DocumentChangeWire => ({
  id,
  elementName: 'ins',
  kind: 'insert',
  storyPartName: 'word/document.xml',
  paragraphId,
  text: 'added',
})

function modelWith(
  paragraphs: Array<{ id: string; runs?: number }>,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphs.map(({ id, runs = 0 }) => ({
          id,
          runs: Array.from({ length: runs }, (_, index) => ({
            id: `${id}-r${index}`,
            text: 'x',
            preservedXmlFragments: [],
          })),
          preservedXmlFragments: [],
        })),
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
  }
}

describe('rejectedShellParagraphIds', () => {
  it('names an empty paragraph whose only change is a rejected insertion', () => {
    const model = modelWith([{ id: 'p1' }, { id: 'p2', runs: 1 }])
    const changes = [inserted('c1', 'p1'), inserted('c2', 'p2')]

    // p2 keeps visible runs, so rejecting its insertion leaves no shell.
    expect(
      rejectedShellParagraphIds(model, changes, new Set(['c1', 'c2'])),
    ).toEqual(['p1'])
  })

  it('spares a shell holding a change that is not a rejected insertion', () => {
    const model = modelWith([{ id: 'p1' }])
    const changes = [
      inserted('c1', 'p1'),
      {
        id: 'c2',
        elementName: 'rPrChange',
        kind: 'property',
        scope: 'run',
        storyPartName: 'word/document.xml',
        paragraphId: 'p1',
        text: '',
      } satisfies DocumentChangeWire,
    ]

    // Rejecting c1 alone would strand the undecided property change inside a
    // removed paragraph; and the removal rule only covers paragraphs whose
    // content is wholly insertions, so the shell is never named while a
    // non-insert change lives inside it.
    expect(rejectedShellParagraphIds(model, changes, new Set(['c1']))).toEqual(
      [],
    )
    expect(
      rejectedShellParagraphIds(model, changes, new Set(['c1', 'c2'])),
    ).toEqual([])
  })

  it('spares an empty paragraph with no pending changes', () => {
    const model = modelWith([{ id: 'p1' }])
    expect(rejectedShellParagraphIds(model, [], new Set(['c1']))).toEqual([])
  })
})
