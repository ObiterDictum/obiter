import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { flowParagraphIds } from './document-edits'
import { applyPasteText, splitPasteLines } from './document-paste'
import { blockText, emptyEditorState } from './document-word-edits'

function paragraph(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function model(...paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: 'word/document.xml',
        paragraphs,
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

const doc = () => model(paragraph('p1', 'Alpha'), paragraph('p2', 'Bravo'))

describe('splitPasteLines', () => {
  it('normalises CRLF and bare CR and keeps trailing empty lines', () => {
    expect(splitPasteLines('A\r\nB\rC')).toEqual(['A', 'B', 'C'])
    expect(splitPasteLines('A\n')).toEqual(['A', ''])
    expect(splitPasteLines('')).toEqual([''])
  })
})

describe('applyPasteText at a caret', () => {
  function pasteAtCaret(text: string) {
    const wire = doc()
    let next = 0
    const outcome = applyPasteText(
      wire,
      emptyEditorState(),
      { kind: 'caret', caret: { paragraphId: 'p1', offset: 2 } },
      text,
      () => `n${String((next += 1))}`,
    )
    if (outcome.status !== 'applied') throw new Error('expected a paste')
    const ids = flowParagraphIds(
      wire,
      outcome.state.inserts,
      outcome.state.deletedParagraphIds,
    )
    return {
      paragraphs: ids.map((id) => blockText(wire, outcome.state, id)),
      caret: outcome.caret,
    }
  }

  it('inserts a single line into the paragraph', () => {
    expect(pasteAtCaret('X')).toEqual({
      paragraphs: ['AlXpha', 'Bravo'],
      caret: { paragraphId: 'p1', offset: 3 },
    })
  })

  it('splits two lines into two paragraphs', () => {
    expect(pasteAtCaret('A\nB')).toEqual({
      paragraphs: ['AlA', 'Bpha', 'Bravo'],
      caret: { paragraphId: 'n1', offset: 1 },
    })
  })

  it('splits three lines into three paragraphs', () => {
    expect(pasteAtCaret('A\nB\nC')).toEqual({
      paragraphs: ['AlA', 'B', 'Cpha', 'Bravo'],
      caret: { paragraphId: 'n2', offset: 1 },
    })
  })

  it('turns a trailing newline into a new empty paragraph', () => {
    expect(pasteAtCaret('A\n').paragraphs).toEqual(['AlA', 'pha', 'Bravo'])
  })

  it('treats CRLF as one paragraph break', () => {
    expect(pasteAtCaret('A\r\nB').paragraphs).toEqual(['AlA', 'Bpha', 'Bravo'])
  })

  it('handles an empty payload as a no-op', () => {
    const wire = doc()
    const outcome = applyPasteText(
      wire,
      emptyEditorState(),
      { kind: 'caret', caret: { paragraphId: 'p1', offset: 2 } },
      '',
      () => 'n1',
    )
    expect(outcome).toEqual({ status: 'empty' })
  })
})

describe('applyPasteText over a selection', () => {
  function pasteOver(text: string) {
    const wire = doc()
    let next = 0
    const outcome = applyPasteText(
      wire,
      emptyEditorState(),
      {
        kind: 'range',
        from: { paragraphId: 'p1', offset: 2 },
        to: { paragraphId: 'p2', offset: 2 },
      },
      text,
      () => `n${String((next += 1))}`,
    )
    if (outcome.status !== 'applied') throw new Error('expected a paste')
    const ids = flowParagraphIds(
      wire,
      outcome.state.inserts,
      outcome.state.deletedParagraphIds,
    )
    return {
      paragraphs: ids.map((id) => blockText(wire, outcome.state, id)),
      caret: outcome.caret,
    }
  }

  it('replaces a range spanning paragraphs with a single line', () => {
    expect(pasteOver('X')).toEqual({
      paragraphs: ['AlXavo'],
      caret: { paragraphId: 'p1', offset: 3 },
    })
  })

  it('splits a range paste into paragraphs, keeping the tail attached', () => {
    expect(pasteOver('X\nY')).toEqual({
      paragraphs: ['AlX', 'Yavo'],
      caret: { paragraphId: 'n1', offset: 1 },
    })
  })

  it('keeps the tail attached for a trailing newline', () => {
    expect(pasteOver('X\n').paragraphs).toEqual(['AlX', 'avo'])
  })
})
