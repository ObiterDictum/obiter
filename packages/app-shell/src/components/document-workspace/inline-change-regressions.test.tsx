import '@obiter/test-dom'
import { afterEach, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  DocumentChangeWire,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { createBlankDocx, parseDocx } from '@obiter/ooxml'
import {
  collectEditOperations,
  replacedEmptyParagraphIds,
} from '../../document-edit-operations'
import { emptyDraftState } from '../../document-draft-state'
import { partitionDraftState } from '../../document-save-partition'
import {
  joinIntoPrevious,
  emptyEditorState,
  applyWordEdit,
  paragraphJoinRefusal,
} from '../../document-word-edits'
import { inlineChanges } from '../../document-inline-changes'
import { effectiveParagraph } from '../../document-model-text'
import { layoutDocument } from '../../document-page-engine'
import { marginBandHeights } from '../../document-page-margin'
import { DocumentModelPage } from './model-view'
import { ModelParagraph } from './model-paragraph'
import { PageMarginBand } from './page-margin-band'
import { InlineChangeReview } from './inline-change-review'
import { paragraphNeighborResolver } from './paragraph-arrow'

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
afterEach(cleanup)
function paint(changes = [deletion], restore = 0, editing = true) {
  return (
    <ModelParagraph
      paragraph={paragraph}
      changes={changes}
      selected={editing}
      editing={editing}
      onSelectParagraph={() => undefined}
      restoreCaret={{ paragraphId: 'p', offset: restore }}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
    />
  )
}
async function modelOf(
  paragraphs = [paragraph],
  changes = [deletion],
): Promise<DocumentModelWire> {
  const { model } = await parseDocx(await createBlankDocx())
  const story = model.stories[0]
  if (!story) throw new Error('Missing body story')
  story.paragraphs = paragraphs
  model.changes = changes
  return model
}
it('blocks restored text instead of replacing a wholly tracked paragraph', async () => {
  const p = { ...paragraph, runs: [] }
  const model = await modelOf(
    [p],
    [{ ...deletion, inlinePosition: { beforeRunId: null } }],
  )
  const extras = { p: [{ id: 'extra', text: 'X', preservedXmlFragments: [] }] }
  expect([...replacedEmptyParagraphIds([p], extras, {}, model)]).toEqual([])
  expect(collectEditOperations(model, {}, [], [], extras)).toEqual([])
  const partition = partitionDraftState(model, {
    ...emptyDraftState(),
    extraRuns: extras,
  })
  expect(partition.keep.extraRuns).toEqual({})
  expect(partition.blocked).toEqual([
    expect.objectContaining({
      slot: { kind: 'extra-runs', key: 'extra:p', paragraphId: 'p' },
    }),
  ])
})
for (const modifier of ['ctrlKey', 'altKey', 'metaKey'])
  for (const shiftKey of [false, true]) {
    it(`moves ${modifier} arrows through revisions with shift=${shiftKey}`, () => {
      render(paint())
      const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
      field.setSelectionRange(12, 12)
      fireEvent.keyDown(field, {
        key: 'ArrowRight',
        [modifier]: true,
        shiftKey,
      })
      const right = modifier === 'ctrlKey' ? 13 : 18
      expect([field.selectionStart, field.selectionEnd]).toEqual([
        shiftKey ? 6 : right,
        right,
      ])
      field.setSelectionRange(18, 18)
      fireEvent.keyDown(field, { key: 'ArrowLeft', [modifier]: true, shiftKey })
      const left = modifier === 'metaKey' ? 0 : 13
      expect([field.selectionStart, field.selectionEnd]).toEqual([
        left,
        shiftKey ? 18 : left,
      ])
      if (shiftKey) expect(field.selectionDirection).toBe('backward')
    })
  }
it('moves Meta arrows to the wrapped line edge, not the paragraph edge', () => {
  const long = {
    ...paragraph,
    runs: [
      { id: 'a', text: 'Order '.repeat(20), preservedXmlFragments: [] },
      { id: 'b', text: ' units'.repeat(20), preservedXmlFragments: [] },
    ],
  }
  render(
    <ModelParagraph
      paragraph={long}
      changes={[deletion]}
      selected
      editing
      onSelectParagraph={() => undefined}
      restoreCaret={{ paragraphId: 'p', offset: 0 }}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
      wrapWidthPx={200}
    />,
  )
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  field.setSelectionRange(0, 0)
  fireEvent.keyDown(field, { key: 'ArrowRight', metaKey: true })
  expect(field.selectionStart).toBeGreaterThan(0)
  expect(field.selectionStart).toBeLessThan(field.value.length / 2)
})
it('preserves native tracked-word selection through a mapped-caret update', () => {
  const changes = [deletion]
  const { rerender } = render(paint(changes))
  const field = screen.getByLabelText<HTMLTextAreaElement>('Paragraph text')
  field.setSelectionRange(8, 8)
  fireEvent.select(field)
  expect(field.selectionStart).toBe(8)
  field.setSelectionRange(6, 12)
  fireEvent.select(field)
  rerender(paint(changes, 6))
  expect([field.selectionStart, field.selectionEnd]).toEqual([6, 12])
  expect(field.getAttribute('aria-description')).toBe(
    'Tracked changes by Unknown author',
  )
})
it('exposes revision roles and limits review tab stops', () => {
  const changes: DocumentChangeWire[] = [
    deletion,
    { ...deletion, id: 'ins', kind: 'insert', elementName: 'ins' },
  ]
  const { container, rerender } = render(
    <ModelParagraph
      paragraph={paragraph}
      changes={changes}
      selected={false}
      onSelectParagraph={() => undefined}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
    />,
  )
  expect(container.querySelector('[role=deletion]')).not.toBeNull()
  expect(container.querySelector('[role=insertion]')).not.toBeNull()
  rerender(
    <InlineChangeReview
      value={{ tabChangeId: 'del', selectChange: () => undefined }}
    >
      {paint(changes, 0, false)}
    </InlineChangeReview>,
  )
  expect(
    container.querySelectorAll('[data-inline-change][tabindex="0"]'),
  ).toHaveLength(1)
  expect(
    container.querySelectorAll('[data-inline-change][tabindex="-1"]'),
  ).toHaveLength(1)
})
it('paints tracked page and column breaks as labelled marks, not line breaks', () => {
  const change: DocumentChangeWire = {
    ...deletion,
    text: 'a\fb\vc',
    inlinePosition: {
      beforeRunId: 'b',
      segments: [{ text: 'a\fb\vc', deleted: true }],
    },
  }
  const projection = inlineChanges(paragraph, [change], change.storyPartName)
  expect(projection.text).toBe('Order a\u21dfb\u21e5c units')
  expect(projection.text).not.toContain('\n')
  const { container } = render(paint([change], 0, false))
  expect(
    [...container.querySelectorAll('[data-inline-change] [role=img]')].map(
      (node) => node.getAttribute('aria-label'),
    ),
  ).toEqual(['Page break', 'Column break'])
})
it('paints nested segments with one review target', () => {
  const change: DocumentChangeWire = {
    ...deletion,
    kind: 'insert',
    elementName: 'ins',
    text: 'ac',
    inlinePosition: {
      beforeRunId: 'b',
      segments: [
        { text: 'a', deleted: false },
        { text: 'b', deleted: true },
        { text: 'c', deleted: false },
      ],
    },
  }
  const { container } = render(paint([change]))
  expect(container.querySelector('[data-caret-run-overlay]')?.textContent).toBe(
    'Order abc units',
  )
  expect(
    [...container.querySelectorAll('[data-inline-change]')].map((node) =>
      node.getAttribute('role'),
    ),
  ).toEqual(['insertion', 'deletion', 'insertion'])
})
for (const kind of ['footnotes', 'endnotes'] as const) {
  it(`uses the owning part in every paginated ${kind} fragment`, async () => {
    const p = {
      ...paragraph,
      id: 'note',
      runs: paragraph.runs.map((run) => ({ ...run, id: `note-${run.id}` })),
    }
    const text = 'TRACKED '.repeat(1200)
    const c = {
      ...deletion,
      paragraphId: p.id,
      text,
      storyPartName: `word/${kind}.xml`,
      inlinePosition: { beforeRunId: 'note-b' },
    }
    const model = await modelOf([paragraph], [c])
    const body = model.stories[0]
    if (!body) throw new Error('Missing body story')
    const tag = kind === 'footnotes' ? 'footnote' : 'endnote'
    body.paragraphs = [
      {
        ...paragraph,
        runs: [
          {
            id: 'ref',
            text: 'Body',
            preservedXmlFragments: [`<w:${tag}Reference w:id="1"/>`],
          },
        ],
      },
    ]
    model.stories.push({
      ...body,
      kind,
      partName: c.storyPartName,
      paragraphs: [p],
      preservedXmlFragments: [`<w:${tag} w:id="1"><w:p/></w:${tag}>`],
    })
    const pages = layoutDocument(model)
    const { container } = render(
      <>
        {pages.map((page, i) => (
          <DocumentModelPage
            key={i}
            model={model}
            pageBlocks={page.blocks}
            pageLayout={page}
            selectedParagraphId={null}
            onSelectParagraph={() => undefined}
          />
        ))}
      </>,
    )
    const fragments = container.querySelectorAll('[data-paragraph-id="note"]')
    expect(fragments.length).toBeGreaterThan(1)
    expect(
      [...container.querySelectorAll('[data-inline-change]')]
        .map((node) => node.textContent)
        .join(''),
    ).toBe(text)
    expect([...fragments].every((node) => node.textContent?.trim())).toBe(true)
  })
}
it('reserves painted height for a branded header carrying revisions', async () => {
  const model = await modelOf()
  const body = model.stories[0]
  if (!body) throw new Error('Missing body story')
  const header = {
    ...body,
    kind: 'header' as const,
    partName: 'word/header1.xml',
    paragraphs: [
      {
        ...paragraph,
        id: 'header',
        runs: [
          {
            id: 'logo',
            text: '',
            preservedXmlFragments: [
              '<w:drawing><wp:inline><wp:extent cx="1714500" cy="457200"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>',
            ],
          },
        ],
      },
    ],
  }
  model.stories.push(header)
  model.changes = [
    {
      ...deletion,
      paragraphId: 'header',
      storyPartName: header.partName,
      text: 'Header revision '.repeat(300),
      inlinePosition: { beforeRunId: null },
    },
  ]
  expect(marginBandHeights(model).headerPx).toBeGreaterThan(200)
})

for (const kind of ['header', 'footer'] as const) {
  it(`renders ${kind} revisions with a link cue and the correct story`, async () => {
    const model = await modelOf()
    const body = model.stories[0]
    if (!body) throw new Error('Missing body story')
    const story = { ...body, kind, partName: `word/${kind}1.xml` }
    const change = {
      ...deletion,
      storyPartName: story.partName,
      inlinePosition: {
        beforeRunId: 'b',
        segments: [
          {
            text: 'linked',
            deleted: true,
            hyperlinkTarget: 'https://example.com',
          },
        ],
      },
    }
    const { container } = render(
      <PageMarginBand
        stories={[story]}
        changes={[deletion, change]}
        label={kind}
        edge={kind === 'header' ? 'top' : 'bottom'}
        padding={{ left: 0, right: 0, edge: 0 }}
      />,
    )
    expect(container.querySelector('[role=deletion]')?.textContent).toBe(
      'linked',
    )
    expect(container.querySelectorAll('[data-inline-change]')).toHaveLength(1)
    const deleted = container.querySelector<HTMLElement>('[role=deletion]')
    expect(deleted?.style.textDecoration).toBe('line-through')
    expect(
      deleted?.querySelector('[data-hyperlink-target]')?.getAttribute('title'),
    ).toBe('https://example.com')
  })
}

it('refuses local edits and joins whose save would erase tracked subtrees, not joins after them', async () => {
  const previous = {
    ...paragraph,
    id: 'previous',
    runs: [{ id: 'first', text: 'First', preservedXmlFragments: [] }],
  }
  const model = await modelOf([previous, paragraph])
  expect(paragraphJoinRefusal(model, emptyEditorState(), paragraph.id)).toBe(
    'tracked-change',
  )
  const trailing = { ...deletion, inlinePosition: { beforeRunId: null } }
  const into = await modelOf(
    [paragraph, { ...previous, id: 'next' }],
    [trailing],
  )
  const joined = joinIntoPrevious(into, emptyEditorState(), 'next')
  if (!joined) throw new Error('Expected the join to apply')
  const merged = effectiveParagraph(
    paragraph,
    joined.state.drafts,
    joined.state.extraRuns[paragraph.id],
  )
  expect(inlineChanges(merged, into.changes, deletion.storyPartName).text).toBe(
    'Order  unitsFirst60,000',
  )
  expect(
    collectEditOperations(
      into,
      joined.state.drafts,
      [],
      joined.state.deletedParagraphIds,
      joined.state.extraRuns,
    ),
  ).toContainEqual({
    type: 'replace_run_text',
    runId: 'b',
    text: ' unitsFirst',
  })
  const bare = await modelOf(
    [
      { ...paragraph, runs: [] },
      { ...previous, id: 'next' },
    ],
    [trailing],
  )
  expect(paragraphJoinRefusal(bare, emptyEditorState(), 'next')).toBe(
    'tracked-change',
  )
  const plain = await modelOf([previous, { ...previous, id: 'next' }], [])
  expect(joinIntoPrevious(plain, emptyEditorState(), 'next')).toBeDefined()
  const whole = await modelOf(
    [{ ...paragraph, runs: [] }],
    [{ ...deletion, inlinePosition: { beforeRunId: null } }],
  )
  expect(
    applyWordEdit(
      whole,
      emptyEditorState(),
      { type: 'replace', paragraphId: 'p', offset: 0, insert: 'X' },
      'new',
    ),
  ).toBeUndefined()
})

it('steps the caret over a revision-only paragraph instead of into it', async () => {
  const around = (id: string) => ({
    ...paragraph,
    id,
    runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
  })
  const tracked = { ...paragraph, runs: [] }
  const model = await modelOf(
    [around('before'), tracked, around('after')],
    [{ ...deletion, inlinePosition: { beforeRunId: null } }],
  )
  const neighbors = paragraphNeighborResolver({
    model,
    inserts: [],
    deletedParagraphIds: [],
    paragraphs: model.stories[0]?.paragraphs ?? [],
  })
  expect(neighbors('before').next?.id).toBe('after')
  expect(neighbors('after').previous?.id).toBe('before')
})
it('keeps an empty opaque revision read-only too', () => {
  const { container } = render(
    <ModelParagraph
      paragraph={{ ...paragraph, runs: [] }}
      changes={[
        {
          ...deletion,
          text: '',
          inlinePosition: { beforeRunId: null, segments: [] },
        },
      ]}
      selected
      editing
      onSelectParagraph={() => undefined}
      storyPartName="word/document.xml"
      relationships={[]}
      imageUrls={{}}
      styles={[]}
    />,
  )
  expect(container.querySelector('textarea')).toBeNull()
})
