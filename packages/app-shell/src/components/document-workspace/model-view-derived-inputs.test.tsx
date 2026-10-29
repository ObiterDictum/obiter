import '@obiter/test-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentModelWire } from '@obiter/contracts'

const counts = vi.hoisted(() => ({ notes: 0, neighbors: 0 }))
const arrows = { ...(await import('./paragraph-arrow')) }
mock.module('./paragraph-arrow', () => ({
  ...arrows,
  paragraphNeighborResolver: (
    ...args: Parameters<typeof arrows.paragraphNeighborResolver>
  ) => {
    counts.neighbors += 1
    return arrows.paragraphNeighborResolver(...args)
  },
}))

const documentPageNotesModule = {
  ...(await import('../../document-page-notes')),
}
const documentPageNotesModuleKeys = Object.fromEntries(
  Object.keys(await import('../../document-page-notes')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('../../document-page-notes', () =>
  Object.assign(
    { ...documentPageNotesModuleKeys },
    (() => {
      const actual = documentPageNotesModule
      return {
        ...actual,
        documentNotes: (...args: Parameters<typeof actual.documentNotes>) => {
          counts.notes += 1
          return actual.documentNotes(...args)
        },
      }
    })(),
  ),
)

const { DocumentModelPage } = await import('./model-view')

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
        {
          id: 'p2',
          runs: [{ id: 'r2', text: 'World', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        },
      ],
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

function page(props: {
  inserts?: Parameters<typeof DocumentModelPage>[0]['inserts']
  deletedParagraphIds?: string[]
  pageNumber: number
}) {
  return (
    <DocumentModelPage
      model={model}
      selectedParagraphId={null}
      onSelectParagraph={() => undefined}
      {...props}
    />
  )
}

afterEach(cleanup)

describe('DocumentModelPage structural inputs', () => {
  it('holds the derived set across a re-render when the structural props are omitted', () => {
    const view = render(page({ pageNumber: 1 }))
    counts.notes = 0
    counts.neighbors = 0
    view.rerender(page({ pageNumber: 2 }))
    expect(counts.notes).toBe(0)
    expect(counts.neighbors).toBe(0)
  })

  it('updates navigation when deletions change without rescanning notes', () => {
    const view = render(page({ deletedParagraphIds: [], pageNumber: 1 }))
    expect(
      view.container.querySelector('[data-paragraph-id="p2"]'),
    ).not.toBeNull()
    counts.notes = 0
    counts.neighbors = 0
    view.rerender(page({ deletedParagraphIds: ['p2'], pageNumber: 1 }))
    expect(view.container.querySelector('[data-paragraph-id="p2"]')).toBeNull()
    expect(counts.notes).toBe(0)
    expect(counts.neighbors).toBe(1)
  })

  it('updates navigation when inserts change without rescanning notes', () => {
    const view = render(page({ inserts: [], pageNumber: 1 }))
    counts.notes = 0
    counts.neighbors = 0
    view.rerender(
      page({
        inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
        pageNumber: 1,
      }),
    )
    expect(counts.notes).toBe(0)
    expect(counts.neighbors).toBe(1)
  })
})
