import { escapeCitationHtml, formatJudgmentCitation } from './judgment-citation'

export function readJudgmentSelection(article: HTMLElement) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  const document = article.querySelector('article') ?? article
  if (
    !document.contains(range.startContainer) ||
    !document.contains(range.endContainer)
  )
    return null
  if (
    !article.contains(range.startContainer) ||
    !article.contains(range.endContainer)
  )
    return null
  const paragraphs = Array.from(
    article.querySelectorAll<HTMLElement>('[data-court-paragraph]'),
  ).filter((element) => range.intersectsNode(element))
  const first = paragraphs[0]
  const last = paragraphs.at(-1)
  if (!first || !last) return null
  const fragment = range.cloneContents()
  fragment
    .querySelectorAll(
      '[data-paragraph-gutter], [data-page-marker], [data-judgment-note], [data-judgment-image]',
    )
    .forEach((gutter) => {
      const label = gutter
        .querySelector<HTMLElement>('[data-quote-label]')
        ?.getAttribute('data-quote-label')
      if (label) gutter.replaceWith(`${label} `)
      else gutter.remove()
    })
  const selectedParagraphs = Array.from(
    fragment.querySelectorAll('[data-court-paragraph]'),
  )
  const text = selectedParagraphs.length
    ? selectedParagraphs
        .map((paragraph) => paragraph.textContent ?? '')
        .join('\n\n')
    : (fragment.textContent ?? '')
  const startElement =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
  const source = startElement?.closest<HTMLElement>('[data-source-text]')
  const prefix = range.cloneRange()
  if (source) {
    prefix.selectNodeContents(source)
    prefix.setEnd(range.startContainer, range.startOffset)
  }
  const page =
    source?.dataset.pageAnchorOnly === 'true' && prefix.toString().length > 0
      ? undefined
      : source?.dataset.judgmentPage
  const bounds = range.getBoundingClientRect()
  return {
    text,
    first: Number(first.dataset.courtParagraph),
    last: Number(last.dataset.courtParagraph),
    page: page ? Number(page) : undefined,
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - 240)),
    top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 48)),
  }
}

export async function copyJudgmentSelection(
  name: string,
  citation: string | null,
  selection: { text: string; first: number; last: number; page?: number },
) {
  const formatted = formatJudgmentCitation(
    name,
    citation,
    selection.first,
    selection.last,
    selection.page,
  )
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/plain': new Blob([`“${selection.text}”\n${formatted.text}`], {
        type: 'text/plain',
      }),
      'text/html': new Blob(
        [
          `<p>“${escapeCitationHtml(selection.text)}”</p><p>${formatted.html}</p>`,
        ],
        { type: 'text/html' },
      ),
    }),
  ])
}
