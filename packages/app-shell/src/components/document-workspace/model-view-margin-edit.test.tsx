import '@obiter/test-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import { DocumentModelPage } from './model-view'

function paragraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] as string[] }],
    preservedXmlFragments: [] as string[],
  }
}

const header = {
  partName: 'word/header1.xml',
  kind: 'header' as const,
  paragraphs: [paragraph('h1', 'Running head')],
  preservedXmlFragments: [] as string[],
}

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [paragraph('p1', 'Body text')],
      preservedXmlFragments: [],
    },
    header,
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
}

afterEach(() => {
  cleanup()
})

describe('an open margin story', () => {
  it('paints the band through the editable paragraph renderer', () => {
    render(
      <DocumentModelPage
        model={model}
        marginEditing={header}
        selectedParagraphId="h1"
        onSelectParagraph={() => undefined}
        editing
      />,
    )
    const band = screen.getByLabelText('Document header')
    expect(band.querySelector('[data-paragraph-id="h1"]')).not.toBeNull()
    expect(within(band).getByLabelText('Paragraph text')).toBeTruthy()
    // The body keeps painting but holds no editable field.
    const body = screen.getByLabelText('Document body')
    expect(body.textContent).toContain('Body text')
    expect(body.querySelector('textarea')).toBeNull()
  })

  it('keeps the band read-only while no margin story is open', () => {
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
      />,
    )
    const band = screen.getByLabelText('Document header')
    expect(band.textContent).toContain('Running head')
    expect(band.querySelector('textarea')).toBeNull()
    // The read-only band takes no pointer events.
    expect(band.className).toContain('pointer-events-none')
  })

  it('places the caret on a band paragraph when it is clicked', () => {
    const selected: string[] = []
    render(
      <DocumentModelPage
        model={model}
        marginEditing={header}
        selectedParagraphId={null}
        onSelectParagraph={(id) => selected.push(id)}
        editing
      />,
    )
    fireEvent.click(screen.getByText('Running head'), {
      clientX: 24,
      clientY: 12,
    })
    expect(selected).toEqual(['h1'])
  })

  it('ignores a click that resolves to a read-only story paragraph', () => {
    const selected: string[] = []
    render(
      <DocumentModelPage
        model={model}
        marginEditing={header}
        selectedParagraphId={null}
        onSelectParagraph={(id) => selected.push(id)}
        editing
      />,
    )
    // Clicking inside the editable band but below its paragraphs lands on the
    // nearest editable paragraph, never on the body.
    const band = screen.getByLabelText('Document header')
    fireEvent.click(band, { clientX: 24, clientY: 400 })
    expect(selected).toEqual(['h1'])
  })

  it('closes margin editing when the body is clicked', () => {
    const selected: string[] = []
    let exited = false
    render(
      <DocumentModelPage
        model={model}
        marginEditing={header}
        selectedParagraphId="h1"
        onSelectParagraph={(id) => selected.push(id)}
        onExitMarginEditing={() => {
          exited = true
        }}
        editing
      />,
    )
    fireEvent.click(screen.getByText('Body text'), {
      clientX: 24,
      clientY: 12,
    })
    expect(exited).toBe(true)
    // The focused margin field may reseat its caret on blur first; the click
    // still ends on the body paragraph.
    expect(selected.at(-1)).toBe('p1')
  })
})
