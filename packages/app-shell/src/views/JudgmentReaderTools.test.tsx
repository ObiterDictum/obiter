import '@obiter/test-dom'
import { afterEach, expect, it, mock } from 'bun:test'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { ToastProvider, Toaster } from '@obiter/ui'
import { JudgmentReaderTools } from './JudgmentReaderTools'
import { JudgmentParagraphActions } from './JudgmentParagraphActions'
import {
  copyJudgmentSelection,
  readJudgmentSelection,
} from './judgment-selection'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  window.getSelection()?.removeAllRanges()
})
function setup() {
  return render(
    <ToastProvider>
      <Toaster />
      <JudgmentReaderTools
        name="A v B"
        citation="[2012] UKSC 19"
        clearSearch={() => {}}
      >
        <article>
          <p id="para-136" data-court-paragraph="136" tabIndex={-1}>
            <JudgmentParagraphActions
              number={136}
              text="First paragraph"
              name="A v B"
              citation="[2012] UKSC 19"
            />
            <span>First paragraph</span>
          </p>
          <span id="page-47" tabIndex={-1}>
            Page 47
          </span>
          <p id="para-137" data-court-paragraph="137" tabIndex={-1}>
            Last paragraph
          </p>
        </article>
      </JudgmentReaderTools>
    </ToastProvider>,
  )
}
it('focuses a known paragraph and reports an unknown paragraph', async () => {
  HTMLElement.prototype.scrollIntoView = mock(() => {})
  setup()
  const input = screen.getByRole('textbox', { name: 'Go to paragraph' })
  fireEvent.change(input, { target: { value: '137' } })
  fireEvent.submit(input.closest('form') ?? input)
  await waitFor(() => expect(document.activeElement?.id).toBe('para-137'))
  fireEvent.change(input, { target: { value: '999' } })
  fireEvent.submit(input.closest('form') ?? input)
  await screen.findByText('No paragraph 999')
})
it('focuses the paragraph identified by the URL on load', () => {
  HTMLElement.prototype.scrollIntoView = mock(() => {})
  window.history.replaceState(null, '', '#para-137')
  setup()
  expect(document.activeElement?.id).toBe('para-137')
})
for (const [label, expected] of [
  ['Copy with citation', 'First paragraph\nA v B [2012] UKSC 19 [136]'],
  ['Copy citation', 'A v B [2012] UKSC 19 [136]'],
  ['Copy link', `${window.location.href.split('#')[0]}#para-136`],
]) {
  it(`${label} writes the expected clipboard payload`, async () => {
    const writeText = mock(async () => {})
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    setup()
    fireEvent.click(
      screen.getByRole('button', { name: 'Paragraph 136 actions' }),
    )
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected))
    await screen.findByText('Copied')
  })
}
it('opens with Enter and closes with Escape while keeping the number visible', async () => {
  setup()
  const button = screen.getByRole('button', { name: 'Paragraph 136 actions' })
  fireEvent.keyDown(document.body, { key: 'Tab' })
  button.focus()
  expect(button.tabIndex).toBe(0)
  fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
  fireEvent.keyUp(button, { key: 'Enter', code: 'Enter' })
  fireEvent.click(button)
  await screen.findByRole('menu')
  fireEvent.keyDown(document.activeElement ?? button, {
    key: 'Escape',
    code: 'Escape',
  })
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  expect(button.textContent).toContain('136')
})
it('copies the selected paragraph range as plain text and italic HTML', async () => {
  setup()
  const article = screen.getByRole('article')
  const first = article.querySelector('span')
  const last = article.querySelector('#para-137')
  if (!first?.firstChild || !last?.firstChild)
    throw new Error('Missing fixture')
  const range = document.createRange()
  range.setStart(first.firstChild, 0)
  range.setEnd(last.firstChild, 4)
  range.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20)
  const selection = window.getSelection()
  selection?.addRange(range)
  const quote = readJudgmentSelection(article)
  expect(quote?.first).toBe(136)
  expect(quote?.last).toBe(137)
  const write = mock(async (_items: ClipboardItem[]) => {})
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write },
  })
  if (!quote) throw new Error('Missing selection')
  globalThis.ClipboardItem = class {
    types: string[]
    constructor(
      private data: Record<string, string | Blob | PromiseLike<string | Blob>>,
    ) {
      this.types = Object.keys(data)
    }
    async getType(type: string) {
      const blob = await this.data[type]
      if (!blob) throw new Error('Missing type')
      return typeof blob === 'string' ? new Blob([blob]) : blob
    }
    presentationStyle = 'unspecified' as const
    static supports() {
      return true
    }
  }
  await copyJudgmentSelection('A v B', '[2012] UKSC 19', quote)
  const item = write.mock.calls[0]?.[0][0]
  expect(await (await item?.getType('text/plain'))?.text()).toContain(
    '[136]–[137]',
  )
  expect(await (await item?.getType('text/html'))?.text()).toContain(
    '<i>A v B</i>',
  )
})

it('excludes gutter numbers and action labels from a cross-paragraph quote', () => {
  const { container } = render(
    <article>
      <p data-court-paragraph="1">
        <span data-paragraph-gutter>1</span>
        <span data-body>First paragraph.</span>
      </p>
      <p data-court-paragraph="2">
        <span data-paragraph-gutter>
          <button>2</button>Paragraph actions
        </span>
        <span data-body>Second paragraph.</span>
      </p>
    </article>,
  )
  const article = container.querySelector('article')
  const bodies = container.querySelectorAll('[data-body]')
  const first = bodies[0]?.firstChild
  const last = bodies[1]?.firstChild
  if (!article || !first || !last) throw new Error('Missing quote fixture')
  const range = document.createRange()
  range.setStart(first, 0)
  range.setEnd(last, 6)
  range.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20)
  window.getSelection()?.addRange(range)
  expect(readJudgmentSelection(article)?.text).toBe(
    'First paragraph.\n\nSecond',
  )
})

it('navigates to a PDF page from the input and a page hash', async () => {
  HTMLElement.prototype.scrollIntoView = mock(() => {})
  setup()
  const input = screen.getByRole('textbox', { name: 'Go to paragraph' })
  fireEvent.change(input, { target: { value: 'p. 47' } })
  fireEvent.submit(input.closest('form') ?? input)
  await waitFor(() => expect(document.activeElement?.id).toBe('page-47'))
  expect(window.location.hash).toBe('#page-47')
})
it('copies selected body text without page labels and reads the page at the selection start', () => {
  const { container } = render(
    <article>
      <p data-court-paragraph="137">
        <span data-source-text data-judgment-page="47">
          First part
        </span>
        <span data-page-marker>Page 48 p. 48</span>
        <span data-source-text data-judgment-page="48">
          continued
        </span>
      </p>
    </article>,
  )
  const first = container.querySelector('[data-source-text]')?.firstChild
  const last = container.querySelector('[data-judgment-page="48"]')?.firstChild
  if (!first || !last) throw new Error('Missing fixture')
  const range = document.createRange()
  range.setStart(first, 0)
  range.setEnd(last, 9)
  range.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20)
  window.getSelection()?.addRange(range)
  const quote = readJudgmentSelection(container)
  expect(quote?.page).toBe(47)
  expect(quote?.text).toBe('First partcontinued')
})
