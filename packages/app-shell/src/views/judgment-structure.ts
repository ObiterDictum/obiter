import type { JudgmentParagraph } from '@obiter/contracts'

export function isStructured(paragraphs: JudgmentParagraph[]) {
  return paragraphs.some((paragraph) => paragraph.level !== undefined)
}

export function startsCourtParagraph(
  paragraph: JudgmentParagraph,
  previous: JudgmentParagraph | undefined,
) {
  if (paragraph.level === undefined) return true
  return (
    paragraph.level === 1 &&
    paragraph.style === undefined &&
    (paragraph.label !== undefined ||
      previous?.paragraphNumber !== paragraph.paragraphNumber)
  )
}

export function anchorOwners(paragraphs: JudgmentParagraph[]) {
  const owners = new Map<number, string>()
  paragraphs.forEach((paragraph, index) => {
    if (
      !owners.has(paragraph.paragraphNumber) &&
      startsCourtParagraph(paragraph, paragraphs[index - 1])
    )
      owners.set(paragraph.paragraphNumber, paragraph.id)
  })
  return owners
}

export function courtParagraphText(
  paragraphs: JudgmentParagraph[],
  start: number,
) {
  const first = paragraphs[start]
  if (!first) return ''
  const parts = [first.text.trim()]
  for (const next of paragraphs.slice(start + 1)) {
    if (
      next.paragraphNumber !== first.paragraphNumber ||
      startsCourtParagraph(next, undefined)
    )
      break
    parts.push(
      next.label ? `${next.label} ${next.text.trim()}` : next.text.trim(),
    )
  }
  return parts.join('\n')
}

const lowerWords = new Set(['and', 'of', 'the', 'with'])

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s'’-])(\p{L})/gu,
      (match, before: string, letter: string) =>
        `${before}${letter.toUpperCase()}`,
    )
    .split(' ')
    .map((word, index) =>
      index > 0 && lowerWords.has(word.toLowerCase())
        ? word.toLowerCase()
        : word,
    )
    .join(' ')
}

export function opinionTitle(text: string) {
  const match = /^(.*?)\s*:?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*:?\s*$/.exec(
    text,
  )
  const rawName = (match?.[1] ?? text).replace(/\s*:\s*$/, '').trim()
  const name = rawName === rawName.toUpperCase() ? titleCase(rawName) : rawName
  return { name, note: match?.[2]?.trim() || undefined }
}

export interface Opinion {
  id: string
  at: number
  name: string
  first: number
  last: number
}

export function opinionsOf(paragraphs: JudgmentParagraph[]): Opinion[] {
  const opinions: Opinion[] = []
  paragraphs.forEach((paragraph, index) => {
    const opinion = paragraph.headings
      ?.filter((heading) => heading.kind === 'opinion')
      .at(-1)
    if (opinion)
      opinions.push({
        id: `opinion-${opinions.length + 1}`,
        at: index,
        name: opinionTitle(opinion.text).name,
        first: paragraph.paragraphNumber,
        last: paragraph.paragraphNumber,
      })
    const current = opinions.at(-1)
    if (current && startsCourtParagraph(paragraph, paragraphs[index - 1]))
      current.last = paragraph.paragraphNumber
  })
  return opinions
}
