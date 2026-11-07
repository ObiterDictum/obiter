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
  const bounds = range.getBoundingClientRect()
  return {
    text: selection.toString(),
    first: Number(first.dataset.courtParagraph),
    last: Number(last.dataset.courtParagraph),
    left: Math.max(8, Math.min(bounds.left, window.innerWidth - 240)),
    top: Math.max(8, Math.min(bounds.bottom + 8, window.innerHeight - 48)),
  }
}

export async function copyJudgmentSelection(
  name: string,
  citation: string | null,
  selection: { text: string; first: number; last: number },
) {
  const formatted = formatJudgmentCitation(
    name,
    citation,
    selection.first,
    selection.last,
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
