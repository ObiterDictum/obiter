import '@obiter/test-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentModelWire } from '@obiter/contracts'

/*
 * `DocumentModelPage` derives the page's whole derived set - notes, note
 * markers, page geometry, the story maps and the neighbour index - once per
 * model and structural draft input, in a `useMemo` keyed on `model`,
 * `inserts` and `deletedParagraphIds`. `inserts` and `deletedParagraphIds` are
 * optional, so their defaults must keep identity across renders: a `[]` minted
 * in the signature re-derives the set on every render for any caller that
 * omits them, silently defeating the memo.
 *
 * `documentNotes` is the observable member of that derived set: it is a full
 * pass over the document's stories, and the counter wraps the real function
 * rather than replacing it.
 */
const counts = vi.hoisted(() => ({ notes: 0 }))

// The real module, snapshotted before mock.module registers: a factory
// that awaited its own specifier re-entered the in-flight mock and
// deadlocked under bun's module registry.
const documentPageNotesModule = {
  ...(await import('../../document-page-notes')),
}
// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
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

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
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
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
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
    view.rerender(page({ pageNumber: 2 }))
    expect(counts.notes).toBe(0)
  })

  it('re-derives when the deleted-paragraph set changes', () => {
    const view = render(page({ deletedParagraphIds: [], pageNumber: 1 }))
    counts.notes = 0
    view.rerender(page({ deletedParagraphIds: ['p2'], pageNumber: 1 }))
    expect(counts.notes).toBe(1)
  })

  it('re-derives when the pending inserts change', () => {
    const view = render(page({ inserts: [], pageNumber: 1 }))
    counts.notes = 0
    view.rerender(
      page({
        inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
        pageNumber: 1,
      }),
    )
    expect(counts.notes).toBe(1)
  })
})
