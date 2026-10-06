import '@obiter/test-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type { DocumentParagraphWire } from '@obiter/contracts'
import { paragraphFace } from '../../document-page-style'
import { ParagraphRunPaint } from './model-run'

/** The five runs `insertPageNumber` stores, anchored at the paragraph's end. */
function trailingPageField(paragraphId: string): DocumentParagraphWire {
  return {
    id: paragraphId,
    runs: [
      { id: 'text', text: '0123456789', preservedXmlFragments: [] },
      {
        id: 'begin',
        text: '',
        preservedXmlFragments: ['<w:fldChar w:fldCharType="begin"/>'],
      },
      {
        id: 'instr',
        text: '',
        preservedXmlFragments: [
          '<w:instrText xml:space="preserve"> PAGE </w:instrText>',
        ],
      },
      {
        id: 'sep',
        text: '',
        preservedXmlFragments: ['<w:fldChar w:fldCharType="separate"/>'],
      },
      { id: 'result', text: '', preservedXmlFragments: [] },
      {
        id: 'end',
        text: '',
        preservedXmlFragments: ['<w:fldChar w:fldCharType="end"/>'],
      },
    ],
    preservedXmlFragments: [],
  }
}

function paintedLines(container: HTMLElement) {
  return [...container.querySelectorAll('[data-line-from]')].map(
    (line) => line.textContent,
  )
}

afterEach(() => {
  cleanup()
})

describe('ParagraphRunPaint field ownership', () => {
  it('paints a trailing PAGE field on the last wrapped line only', () => {
    const paragraph = trailingPageField('p1')
    const { container } = render(
      <ParagraphRunPaint
        paragraph={paragraph}
        changes={[]}
        styles={[]}
        face={paragraphFace(paragraph, [])}
        start={0}
        end={10}
        lines={[
          { text: '01234', from: 0, to: 5 },
          { text: '56789', from: 5, to: 10 },
        ]}
        linePx={16}
        wrapWidthPx={100}
        pageNumber={2}
      />,
    )
    expect(paintedLines(container)).toEqual(['01234', '567892'])
  })

  it('paints a trailing PAGE field on the page slice that owns its offset', () => {
    const paragraph = trailingPageField('p1')
    const face = paragraphFace(paragraph, [])
    const props = {
      paragraph,
      changes: [],
      styles: [],
      face,
      lines: [],
      linePx: 16,
      pageNumber: 2,
    }
    const first = render(<ParagraphRunPaint {...props} start={0} end={5} />)
    expect(first.container.textContent).toBe('01234')
    first.unmount()
    const second = render(<ParagraphRunPaint {...props} start={5} end={10} />)
    expect(second.container.textContent).toBe('567892')
  })

  it('still paints a field-only paragraph and a whole-paragraph trailing field', () => {
    const fieldOnly: DocumentParagraphWire = {
      id: 'p-field',
      runs: trailingPageField('p-field').runs.slice(1),
      preservedXmlFragments: [],
    }
    const empty = render(
      <ParagraphRunPaint
        paragraph={fieldOnly}
        changes={[]}
        styles={[]}
        face={paragraphFace(fieldOnly, [])}
        start={0}
        end={0}
        lines={[]}
        linePx={16}
        pageNumber={3}
      />,
    )
    expect(empty.container.textContent).toBe('3')
    empty.unmount()

    const paragraph = trailingPageField('p2')
    const whole = render(
      <ParagraphRunPaint
        paragraph={paragraph}
        changes={[]}
        styles={[]}
        face={paragraphFace(paragraph, [])}
        start={0}
        end={10}
        lines={[]}
        linePx={16}
        pageNumber={3}
      />,
    )
    expect(whole.container.textContent).toBe('01234567893')
  })
})
