import { applyInsertText, emptyEditorState } from '../../document-word-edits'
import { PageMarginBand } from './page-margin-band'
import { layoutDocument } from '../../document-page-engine'
import { DocumentModelPage } from './model-view'
import { paragraphClickCaret } from './model-click-caret'
import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  DocumentModelWire,
  DocumentChangeWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { inlineChanges, inlineSlice } from '../../document-inline-changes'
import {
  paragraphPlainText,
  effectiveParagraph,
} from '../../document-model-text'
import { ModelParagraph, type ParagraphWordEdit } from './model-paragraph'
import { InlineChangeReview } from './inline-change-review'
import { renderedRangeFor } from '../verification/verification-anchor'

const paragraph: DocumentParagraphWire = {
  id: 'p',
  runs: [
    { id: 'a', text: 'Order ', preservedXmlFragments: [] },
    { id: 'b', text: ' units', preservedXmlFragments: [] },
  ],
  preservedXmlFragments: [],
}
const changes: DocumentChangeWire[] = [
  {
    id: 'del',
    elementName: 'del',
    kind: 'delete',
    text: '60,000',
    paragraphId: 'p',
    storyPartName: 'word/document.xml',
    inlinePosition: { beforeRunId: 'b' },
  },
  {
    id: 'ins',
    elementName: 'ins',
    kind: 'insert',
    text: '50,000',
    paragraphId: 'p',
    storyPartName: 'word/document.xml',
    inlinePosition: { beforeRunId: 'b' },
  },
]
afterEach(cleanup)
function modelOf(
  paragraphs: DocumentParagraphWire[],
  changes: DocumentChangeWire[],
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        kind: 'document',
        partName: 'word/document.xml',
        paragraphs,
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes,
    comments: [],
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}
function mount(
  editing = false,
  p = paragraph,
  c = changes,
  onWordEdit?: (edit: ParagraphWordEdit) => void,
) {
  return render(
    <ModelParagraph
      paragraph={p}
      changes={c}
      selected={editing}
      editing={editing}
      onSelectParagraph={() => undefined}
      onWordEdit={onWordEdit}
      restoreCaret={{ paragraphId: 'p', offset: 7 }}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
      wrapWidthPx={500}
      story={{ kind: 'document', partName: 'word/document.xml' }}
    />,
  )
}
it('paints adjacent revisions inline, including a wholly tracked paragraph', () => {
  const { container, unmount } = mount()
  expect(container.querySelector('[data-paragraph-text]')?.textContent).toBe(
    'Order 60,00050,000 units',
  )
  expect(
    container
      .querySelector('[data-change-kind="delete"]')
      ?.getAttribute('style'),
  ).toContain('line-through')
  expect(
    container
      .querySelector('[data-change-kind="insert"]')
      ?.getAttribute('style'),
  ).toContain('underline')
  unmount()
  const whole = changes.map((change) => ({
    ...change,
    inlinePosition: { beforeRunId: null },
  }))
  const rendered = mount(false, { ...paragraph, runs: [] }, whole)
  expect(
    rendered.container.querySelector('[data-paragraph-text]')?.textContent,
  ).toBe('60,00050,000')
})
it('maps typing, selection deletion, backspace and splitting to editable offsets', () => {
  const edits: ParagraphWordEdit[] = []
  mount(true, paragraph, changes, (edit) => edits.push(edit))
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  expect(field.value).toBe('Order 60,00050,000 units')
  expect(field.selectionStart).toBe(19)
  fireEvent.change(field, { target: { value: 'Order 60,00050,000 uXnits' } })
  expect(edits.at(-1)).toMatchObject({
    type: 'replace',
    from: 8,
    to: 8,
    insert: 'X',
  })
  field.setSelectionRange(6, 18)
  fireEvent.change(field, { target: { value: 'Order units' } })
  expect(edits.at(-1)?.insert).not.toContain('60,000')
  field.setSelectionRange(19, 19)
  fireEvent.keyDown(field, { key: 'Backspace' })
  expect(edits.at(-1)).toMatchObject({ type: 'deleteBackward', offset: 7 })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(edits.at(-1)).toMatchObject({ type: 'split', offset: 7 })
})
it('copies only editable characters and jumps across tracked content', () => {
  mount(true)
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  field.setSelectionRange(0, field.value.length)
  const copied: string[] = []
  fireEvent.copy(field, {
    clipboardData: {
      setData: (_kind: string, text: string) => copied.push(text),
    },
  })
  expect(copied).toEqual(['Order  units'])
  field.setSelectionRange(6, 6)
  fireEvent.keyDown(field, { key: 'ArrowRight' })
  expect(field.selectionStart).toBe(19)
  field.setSelectionRange(6, 6)
  fireEvent.keyDown(field, { key: 'ArrowRight', shiftKey: true })
  expect(field.selectionStart).toBe(6)
  expect(field.selectionEnd).toBe(19)
})
it('preserves plain text and paginated display slices without duplicating markup', () => {
  const projected = inlineChanges(paragraph, changes)
  expect(paragraphPlainText(paragraph)).toBe('Order  units')
  expect(projected.toEditable(19)).toBe(7)
  expect(projected.toDisplay(7)).toBe(19)
  expect(inlineSlice(projected, 8, 16).editableText).toBe('')
  expect(
    inlineSlice(projected, 16, projected.text.length).edit('0 units!'),
  ).toBe(' units!')
})
it('shares review highlighting with the panel target and handles clicks', () => {
  const selected: string[] = []
  const { container } = render(
    <InlineChangeReview
      value={{ activeChangeId: 'ins', selectChange: (id) => selected.push(id) }}
    >
      <ModelParagraph
        paragraph={paragraph}
        changes={changes}
        selected={false}
        onSelectParagraph={() => undefined}
        storyPartName="word/document.xml"
        relationships={[]}
        imageUrls={{}}
        styles={[]}
      />
    </InlineChangeReview>,
  )
  expect(
    container
      .querySelector('[data-inline-change="ins"]')
      ?.getAttribute('aria-current'),
  ).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: /Deletion by/u }))
  expect(selected).toEqual(['del'])
})
it('anchors verification to editable text beyond inline revisions', () => {
  const { container } = mount()
  const result = renderedRangeFor(
    container,
    {
      kind: 'mapped',
      paragraphId: 'p',
      storyKind: 'document',
      storyPartName: 'word/document.xml',
      start: 7,
      end: 12,
    },
    'units',
  )
  expect(result.kind).toBe('attached')
})

it('keeps story-local revisions separate when Word repeats a paragraph id', () => {
  const foreign = changes.map((change) => ({
    ...change,
    id: `header-${change.id}`,
    storyPartName: 'word/header1.xml',
    text: 'Header only',
  }))
  expect(
    inlineChanges(paragraph, [...changes, ...foreign], 'word/document.xml')
      .text,
  ).toBe('Order 60,00050,000 units')
})

it('paginates a wholly tracked paragraph once and mounts only one editable caret', () => {
  const text = 'Tracked content '.repeat(600)
  const p = { ...paragraph, runs: [] }
  const insertion = changes[1]
  if (!insertion) throw new Error('Expected insertion')
  const c = { ...insertion, inlinePosition: { beforeRunId: null }, text }
  const previous: DocumentParagraphWire = {
    ...paragraph,
    id: 'previous',
    runs: [
      {
        id: 'previous-r',
        text: 'Previous paragraph',
        preservedXmlFragments: [],
      },
    ],
  }
  const model = modelOf([previous, p], [c])
  const pages = layoutDocument(model)
  expect(pages.length).toBeGreaterThan(1)
  const moves: Array<{ paragraphId: string; offset: number }> = []
  const { container } = render(
    <>
      {pages.map((page, i) => (
        <DocumentModelPage
          key={i}
          model={model}
          pageBlocks={page.blocks}
          pageLayout={page}
          onMoveCaret={(paragraphId, offset) =>
            moves.push({ paragraphId, offset })
          }
          selectedParagraphId="p"
          restoreCaret={{ paragraphId: 'p', offset: 0 }}
          onSelectParagraph={() => undefined}
          editing
        />
      ))}
    </>,
  )
  expect(container.querySelectorAll('textarea').length).toBe(1)
  const field = container.querySelector('textarea')
  if (!field) throw new Error('Expected caret field')
  fireEvent.keyDown(field, { key: 'ArrowUp' })
  expect(moves).toEqual([{ paragraphId: 'previous', offset: 0 }])
  expect(
    [...container.querySelectorAll('[data-inline-change]')]
      .map((span) => span.textContent)
      .join(''),
  ).toBe(text)
})
it('click-to-caret counts only editable glyphs after a revision', () => {
  const { container } = mount()
  const element = container.querySelector<HTMLElement>('[data-paragraph-id]')
  const tail = element?.querySelector('[data-paragraph-text]')?.lastElementChild
    ?.lastElementChild?.firstChild
  if (!element || !tail) throw new Error('Expected trailing ordinary text')
  const pointDocument: Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null
  } = document
  const previous = pointDocument.caretPositionFromPoint
  Object.assign(document, {
    caretPositionFromPoint: () => ({ offsetNode: tail, offset: 1 }),
  })
  try {
    expect(paragraphClickCaret(element, 1, 1, container, () => 12)).toEqual({
      paragraphId: 'p',
      offset: 7,
    })
  } finally {
    Object.assign(document, { caretPositionFromPoint: previous })
  }
})

it('shows a wholly tracked imported header while the margin is closed', () => {
  const insertion = changes[1]
  if (!insertion) throw new Error('Expected insertion')
  const { container } = render(
    <PageMarginBand
      stories={[
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [{ ...paragraph, runs: [] }],
          preservedXmlFragments: [],
          fields: [],
          unanchoredFieldParagraphIds: [],
        },
      ]}
      changes={[
        {
          ...insertion,
          storyPartName: 'word/header1.xml',
          inlinePosition: { beforeRunId: null },
        },
      ]}
      label="Document header"
      edge="top"
      padding={{ left: 0, right: 0, edge: 0 }}
    />,
  )
  expect(container.querySelector('[data-inline-change]')?.textContent).toBe(
    '50,000',
  )
})

it('places the caret at the same side of revisions that the existing writer edits', () => {
  const edited = applyInsertText(
    modelOf([paragraph], changes),
    emptyEditorState(),
    { paragraphId: 'p', offset: 6 },
    'X',
  )
  if (!edited) throw new Error('Expected ordinary insertion')
  const after = inlineChanges(
    effectiveParagraph(paragraph, edited.state.drafts),
    changes,
  )
  expect(after.text).toBe('Order X60,00050,000 units')
  expect(after.toDisplay(edited.caret.offset)).toBe(7)
  const projection = inlineChanges(paragraph, changes)
  expect(projection.toDisplay(6)).toBe(6)
  expect(projection.toDisplay(6, 'after')).toBe(18)
  const endChanges = changes.map((change) => ({
    ...change,
    inlinePosition: { beforeRunId: null },
  }))
  expect(
    inlineChanges(
      { ...paragraph, runs: paragraph.runs.slice(0, 1) },
      endChanges,
    ).toDisplay(6),
  ).toBe(6)
  const leading = inlineChanges(
    { ...paragraph, runs: paragraph.runs.slice(1) },
    changes,
  )
  expect(leading.toDisplay(0)).toBe(12)
})
