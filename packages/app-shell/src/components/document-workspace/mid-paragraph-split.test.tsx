import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

/*
 * E47: pressing Enter mid-paragraph must leave the second half painted in the
 * pending paragraph, editable, and in the draft. The split state was already
 * covered by document-edits.test.ts; this covers the rendered surface the card
 * recorded (an empty paragraph with no editor), which only the mount can show.
 */

const PLAIN =
  '1. I, Margaret Ellison, of 14 Hartley Terrace, London SW1A 1AA, was born on 3 March 1965.'
const PLAIN_LEFT = PLAIN.slice(0, 30)
const PLAIN_RIGHT = PLAIN.slice(30)
const BOLD = '3. On 3 March 2024, I inspected the property and exhibit ME/1.'
const BOLD_LEFT = BOLD.slice(0, 10)
const BOLD_RIGHT = BOLD.slice(10)

function paintedTexts(): string[] {
  return [...document.querySelectorAll('[data-paragraph-id]')].map((node) => {
    const field = node.querySelector('textarea')
    if (field instanceof HTMLTextAreaElement) return field.value
    return node.querySelector('[data-paragraph-text]')?.textContent ?? ''
  })
}

function paragraphIds(): string[] {
  return [...document.querySelectorAll('[data-paragraph-id]')].map(
    (node) => node.getAttribute('data-paragraph-id') ?? '',
  )
}

describe('E47 mid-paragraph Enter', () => {
  it('paints and keeps the second half of a plain paragraph', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          paragraph('p1', PLAIN),
          paragraph('p2', 'Following'),
        ]),
      },
    })
    fireEvent.click(screen.getByText(PLAIN))
    const editor = screen.getByLabelText(
      'Paragraph text',
    ) as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(30, 30)
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(paintedTexts()).toEqual([PLAIN_LEFT, PLAIN_RIGHT, 'Following'])
    const pending = screen.getByLabelText(
      'Pending paragraph text',
    ) as HTMLTextAreaElement
    expect(pending.value).toBe(PLAIN_RIGHT)
    expect(pending).toBe(document.activeElement)
    // The new paragraph is its own block between the two stored paragraphs.
    const ids = paragraphIds()
    expect(ids[0]).toBe('p1')
    expect(ids[1]).not.toBe('p2')
    expect(ids[2]).toBe('p2')
  })

  it('paints and keeps the second half of a bold run', () => {
    mountWorkspace({
      models: {
        doc_1: multiParagraphModel([
          {
            id: 'p1',
            runs: [
              {
                id: 'p1-r1',
                text: BOLD,
                preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
              },
            ],
            preservedXmlFragments: [],
          },
        ]),
      },
    })
    fireEvent.click(screen.getByText(BOLD))
    const editor = screen.getByLabelText(
      'Paragraph text',
    ) as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(10, 10)
    fireEvent.keyDown(editor, { key: 'Enter' })

    expect(paintedTexts()).toEqual([BOLD_LEFT, BOLD_RIGHT])
    expect(
      (screen.getByLabelText('Pending paragraph text') as HTMLTextAreaElement)
        .value,
    ).toBe(BOLD_RIGHT)
  })
})
