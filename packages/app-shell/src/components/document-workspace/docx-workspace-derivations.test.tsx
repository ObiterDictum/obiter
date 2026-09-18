// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
  selectBodyParagraph,
} from './docx-workspace-harness'

/*
 * The workspace derives its painted model, its pagination and its authority
 * list from the document and the draft state. Those derivations are full passes
 * over the document and were recomputed on every render, so a 500-paragraph
 * document was repaginated several times per keystroke and again on every
 * unrelated render (a query settling, presence updating, a panel toggling).
 *
 * The counters wrap the real functions rather than replacing them: the point
 * under test is how often a correct derivation runs, not what it returns.
 */
const counts = vi.hoisted(() => ({
  layout: 0,
  formatted: 0,
  authorities: 0,
  storyBlocks: 0,
  wrapped: [] as string[],
}))

vi.mock('../../document-page-engine', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-page-engine')>()
  return {
    ...actual,
    layoutDocument: (...args: Parameters<typeof actual.layoutDocument>) => {
      counts.layout += 1
      return actual.layoutDocument(...args)
    },
  }
})

vi.mock('../../document-page-tables', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-page-tables')>()
  return {
    ...actual,
    storyBlocks: (...args: Parameters<typeof actual.storyBlocks>) => {
      counts.storyBlocks += 1
      return actual.storyBlocks(...args)
    },
  }
})

vi.mock('../../document-page-flow', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-page-flow')>()
  return {
    ...actual,
    wrapLines: (...args: Parameters<typeof actual.wrapLines>) => {
      counts.wrapped.push(args[0])
      return actual.wrapLines(...args)
    },
  }
})

vi.mock('../../document-format-edits', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-format-edits')>()
  return {
    ...actual,
    formattedModel: (...args: Parameters<typeof actual.formattedModel>) => {
      counts.formatted += 1
      return actual.formattedModel(...args)
    },
  }
})

vi.mock('../../document-authorities', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../document-authorities')>()
  return {
    ...actual,
    extractAuthorities: (
      ...args: Parameters<typeof actual.extractAuthorities>
    ) => {
      counts.authorities += 1
      return actual.extractAuthorities(...args)
    },
  }
})

function reset() {
  counts.layout = 0
  counts.formatted = 0
  counts.authorities = 0
  counts.storyBlocks = 0
  counts.wrapped = []
}

describe('DocxWorkspace document derivations', () => {
  it('does not repaginate on a render that changes no document input', () => {
    const view = mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'World'),
        ]),
      },
    })
    reset()
    rerenderWorkspace(view, 'doc_1')
    expect(counts.layout).toBe(0)
    expect(counts.formatted).toBe(0)
    expect(counts.authorities).toBe(0)
  })

  it('repaginates once for one typed character', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'World'),
        ]),
      },
    })
    selectBodyParagraph()
    const field = screen.getByLabelText('Paragraph text')
    reset()
    fireEvent.change(field, { target: { value: 'Hello!' } })
    expect(counts.layout).toBe(1)
  })

  it('repaginates again when the text changes a second time', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'World'),
        ]),
      },
    })
    selectBodyParagraph()
    const field = screen.getByLabelText('Paragraph text')
    fireEvent.change(field, { target: { value: 'Hello!' } })
    reset()
    fireEvent.change(field, { target: { value: 'Hello!!' } })
    expect(counts.layout).toBe(1)
  })

  it('re-wraps only the paragraph whose text changed', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'World'),
          paragraph('p3', 'Untouched'),
        ]),
      },
    })
    selectBodyParagraph()
    const field = screen.getByLabelText('Paragraph text')
    reset()
    fireEvent.change(field, { target: { value: 'Hello!' } })
    // The edited paragraph measures its new text.
    expect(counts.wrapped.some((text) => text.includes('Hello'))).toBe(true)
    // A paragraph beyond the caret's immediate neighbour is never re-measured:
    // its slice text is unchanged, so the wrap survives the render. The
    // neighbour is measured once to place a vertical arrow, and only once.
    expect(counts.wrapped.filter((text) => text.includes('Untouched'))).toEqual(
      [],
    )
    expect(
      counts.wrapped.filter((text) => text.includes('World')).length,
    ).toBeLessThanOrEqual(1)
  })

  it('does not rescan the story block partition on a keystroke', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', 'Hello'),
          paragraph('p2', 'World'),
        ]),
      },
    })
    selectBodyParagraph()
    const field = screen.getByLabelText('Paragraph text')
    reset()
    fireEvent.change(field, { target: { value: 'Hello!' } })
    expect(counts.storyBlocks).toBe(0)
  })

  it('keeps an untouched paragraph fresh, with its formatting, after a keystroke elsewhere', () => {
    const bold = paragraph('p2', 'World')
    const run = bold.runs[0]
    if (run) run.preservedXmlFragments = ['<w:rPr><w:b/></w:rPr>']
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([paragraph('p1', 'Hello'), bold]),
      },
    })
    selectBodyParagraph()
    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Hello!' },
    })
    // The edited paragraph is fresh...
    expect(
      (screen.getByLabelText('Paragraph text') as HTMLTextAreaElement).value,
    ).toBe('Hello!')
    // ...the untouched one keeps its text and the formatting parsed for it,
    // so memoising its wrap and face did not strand a stale projection.
    const world = screen.getByText('World')
    expect(world).toBeTruthy()
    expect(world.style.fontWeight).toBe('700')
  })
})
