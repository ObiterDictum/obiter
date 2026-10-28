import '@obiter/test-dom'
/*
 * E4 lists and styles: the Styles gallery must not fake chips when a document
 * has no paragraph styles, a real style must apply and save, and the Restart
 * numbering control must apply a start override that reaches the save. The
 * projection and save-plan details live in document-format-edits.test.ts and
 * document-list-toggle.test.ts; this is the mounted-control surface.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
} from './docx-workspace-harness'
import { clickParagraph } from './paragraph-selection-harness'

const PARAGRAPH_STYLE = (styleId: string, name: string) =>
  `<w:style w:type="paragraph" w:styleId="${styleId}"><w:name w:val="${name}"/></w:style>`

function styledModel() {
  return {
    ...multiParagraphModel([paragraph('p1', 'Hello'), paragraph('p2', 'tail')]),
    styles: [
      {
        styleId: 'Heading1',
        sourceFragment: PARAGRAPH_STYLE('Heading1', 'Heading 1'),
      },
      { styleId: 'Quote', sourceFragment: PARAGRAPH_STYLE('Quote', 'Quote') },
    ],
  }
}

function numberedModel() {
  return {
    ...multiParagraphModel([
      {
        id: 'p1',
        runs: [{ id: 'p1-r', text: 'Hello', preservedXmlFragments: [] }],
        preservedXmlFragments: [
          '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
        ],
      },
      paragraph('p2', 'tail'),
    ]),
    numbering: [
      {
        numberingId: '1',
        abstractNumberingId: '0',
        sourceFragment: '<w:num w:numId="1"/>',
        levels: [{ ilvl: 0, numFmt: 'decimal' }],
      },
    ],
  }
}

function operations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return call?.operations ?? []
}

async function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(command('Save'))
  await waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('the Styles gallery and list restart controls', () => {
  it('shows one disabled style control, not fake chips, when a document has no styles', () => {
    mountWorkspace({
      models: { doc_1: multiParagraphModel([paragraph('p1', 'Hello')]) },
    })
    clickParagraph('p1')

    // The picker is a Base UI Select now; its disabled state and the reason
    // are on the combobox trigger, which a name query still reaches.
    const select = screen.getByRole('combobox', {
      name: 'Paragraph style: This document has no paragraph styles.',
    })
    expect(select).toHaveProperty('disabled', true)
    // The old fallback advertised Normal/Heading 1/Quote as pending UI.
    expect(screen.queryByRole('button', { name: /Heading 1/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Quote/ })).toBeNull()
  })

  it('applies a real style from a chip and saves it', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: styledModel() }, editAsync })
    clickParagraph('p1')

    const quote = command('Quote')
    fireEvent.click(quote)
    expect(quote.getAttribute('aria-pressed')).toBe('true')
    expect(
      screen
        .getByRole('button', { name: 'Heading 1' })
        .getAttribute('aria-pressed'),
    ).toBe('false')

    await save(editAsync)
    expect(operations(editAsync)).toContainEqual({
      type: 'set_paragraph_style',
      paragraphId: 'p1',
      styleId: 'Quote',
    })
  })

  it('applies a list restart and saves the start override', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: numberedModel() }, editAsync })
    clickParagraph('p1')

    const restart = command('Restart numbering')
    if (!(restart instanceof HTMLButtonElement)) {
      throw new Error('expected a restart button')
    }
    expect(restart.disabled).toBe(false)
    fireEvent.click(restart)
    expect(restart.getAttribute('aria-pressed')).toBe('true')

    await save(editAsync)
    expect(operations(editAsync)).toContainEqual({
      type: 'set_paragraph_numbering',
      paragraphId: 'p1',
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    })
  })
})
