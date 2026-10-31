import '@obiter/test-dom'
import { expect, it, mock } from 'bun:test'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import type {
  DocumentChangeWire,
  DocumentRelationshipWire,
  DocumentStyleWire,
} from '@obiter/contracts'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { useLatestCallback } from './use-latest-callback'

const actualParagraph = { ...(await import('./model-paragraph')) }
type ParagraphProps = ComponentProps<typeof actualParagraph.ModelParagraphInner>

const paragraphRenders = new Map<string, number>()
const latestParagraphProps = new Map<string, ParagraphProps>()

mock.module('./model-paragraph', () => ({
  ...actualParagraph,
  ModelParagraphInner: (props: ParagraphProps) => {
    paragraphRenders.set(
      props.paragraph.id,
      (paragraphRenders.get(props.paragraph.id) ?? 0) + 1,
    )
    latestParagraphProps.set(props.paragraph.id, props)
    return actualParagraph.ModelParagraphInner(props)
  },
}))

const { mountWorkspace, multiParagraphModel, paragraph } =
  await import('./docx-workspace-harness')
const { ModelParagraph } = await import('./model-paragraph-memo')

const PARAGRAPH_COUNT = 300
const NO_CHANGES: DocumentChangeWire[] = []
const NO_STYLES: DocumentStyleWire[] = []
const NO_RELATIONSHIPS: DocumentRelationshipWire[] = []
const NO_IMAGE_URLS: Record<string, string> = {}
const NO_DRAFTS: Record<string, string> = {}
const noop = () => undefined

function bodyModel() {
  return multiParagraphModel(
    Array.from({ length: PARAGRAPH_COUNT }, (_, index) =>
      paragraph(`p${index}`, `Paragraph ${index} text`),
    ),
  )
}

function renderedParagraphs() {
  return [...paragraphRenders.values()].reduce(
    (total, count) => total + count,
    0,
  )
}

const draftParagraphs = [paragraph('a', 'Alpha'), paragraph('b', 'Bravo')]

function Body({
  drafts,
  selectedId,
  onSelect = noop,
}: {
  drafts: Record<string, string>
  selectedId: string
  onSelect?: (paragraphId: string, offset?: number) => void
}) {
  return (
    <>
      {draftParagraphs.map((item) => (
        <ModelParagraph
          key={item.id}
          paragraph={item}
          changes={NO_CHANGES}
          selected={item.id === selectedId}
          onSelectParagraph={onSelect}
          drafts={drafts}
          storyPartName="word/document.xml"
          relationships={NO_RELATIONSHIPS}
          imageUrls={NO_IMAGE_URLS}
          styles={NO_STYLES}
        />
      ))}
    </>
  )
}

function CallbackProbe({ handler }: { handler: () => void }) {
  const latest = useLatestCallback(handler)
  return <button onClick={latest}>run</button>
}

it('typing into one paragraph re-renders only the edited paragraph', () => {
  mountWorkspace({ models: { doc_1: bodyModel() } })
  fireEvent.click(screen.getByText('Paragraph 0 text'))
  const field = screen.getByLabelText('Paragraph text')
  paragraphRenders.clear()
  fireEvent.change(field, { target: { value: 'Paragraph 0 textX' } })
  expect(renderedParagraphs()).toBeLessThanOrEqual(5)
  expect(paragraphRenders.get('p0')).toBe(1)
  expect(paragraphRenders.has('p1')).toBe(false)
})

it('a non-selected paragraph shows its own draft change', () => {
  const view = render(<Body drafts={NO_DRAFTS} selectedId="b" />)
  expect(screen.getByText('Alpha')).toBeDefined()
  view.rerender(<Body drafts={{ 'a-r': 'Alpha changed' }} selectedId="b" />)
  expect(screen.getByText('Alpha changed')).toBeDefined()
  expect(screen.queryByText('Alpha')).toBeNull()
})

it('a non-selected paragraph picks up a replaced handler', () => {
  const first = () => undefined
  const second = () => undefined
  const view = render(
    <Body drafts={NO_DRAFTS} selectedId="b" onSelect={first} />,
  )
  paragraphRenders.clear()
  view.rerender(<Body drafts={NO_DRAFTS} selectedId="b" onSelect={second} />)
  expect(paragraphRenders.get('a')).toBe(1)
  expect(latestParagraphProps.get('a')?.onSelectParagraph).toBe(second)
})

it('a stable latest callback invokes the replaced handler', () => {
  const first = vi.fn()
  const second = vi.fn()
  const view = render(<CallbackProbe handler={first} />)
  view.rerender(<CallbackProbe handler={second} />)
  fireEvent.click(screen.getByText('run'))
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledTimes(1)
})
