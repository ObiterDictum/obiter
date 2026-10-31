import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import type {
  DocumentChangeWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { applyWordEdit, emptyEditorState } from '../../document-word-edits'
import { multiParagraphModel } from './docx-workspace-harness'
import { ModelParagraph } from './model-paragraph-memo'

const paragraph: DocumentParagraphWire = {
  id: 'p',
  runs: [
    { id: 'a', text: 'Order ', preservedXmlFragments: [] },
    { id: 'b', text: ' units', preservedXmlFragments: [] },
  ],
  preservedXmlFragments: [],
}
const deletion: DocumentChangeWire = {
  id: 'del',
  elementName: 'del',
  kind: 'delete',
  text: '60,000',
  paragraphId: 'p',
  storyPartName: 'word/document.xml',
  inlinePosition: { beforeRunId: 'b' },
}
const model = { ...multiParagraphModel([paragraph]), changes: [deletion] }

afterEach(cleanup)

function TrackedParagraph() {
  const [state, setState] = useState(emptyEditorState)
  return (
    <ModelParagraph
      paragraph={paragraph}
      changes={[deletion]}
      drafts={state.drafts}
      selected
      editing
      onSelectParagraph={() => undefined}
      onWordEdit={(edit) =>
        setState(
          (current) =>
            applyWordEdit(model, current, edit, 'new')?.state ?? current,
        )
      }
      restoreCaret={{ paragraphId: 'p', offset: 3 }}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
    />
  )
}

const setValue = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  'value',
)?.set

function typeAtCaret(field: HTMLTextAreaElement, character: string) {
  const at = field.selectionStart
  const next =
    field.value.slice(0, at) + character + field.value.slice(field.selectionEnd)
  act(() => {
    setValue?.call(field, next)
    field.setSelectionRange(at + 1, at + 1)
    fireEvent.input(field)
  })
}

it('keeps typed characters in order in a paragraph with a tracked change', () => {
  render(<TrackedParagraph />)
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  expect(field.value).toBe('Order 60,000 units')
  expect(field.selectionStart).toBe(3)
  for (const character of 'XYZ') typeAtCaret(field, character)
  expect(field.value).toBe('OrdXYZer 60,000 units')
  expect(field.selectionStart).toBe(6)
})
