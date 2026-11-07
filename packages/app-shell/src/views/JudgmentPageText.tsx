import { pageAtPosition, type PlacedPage } from './judgment-pages'

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return text

  const index = text.toLowerCase().indexOf(query.toLowerCase())
  if (index < 0) return text

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-brand-soft px-0.5 text-paper-ink">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  )
}

export function JudgmentPageText({
  text,
  query,
  pages = [],
  at,
}: {
  text: string
  query: string
  at: number
  pages?: PlacedPage[]
}) {
  let offset = 0
  const sourceText = (value: string, start: number) => (
    <span
      data-source-text
      data-judgment-page={pageAtPosition(pages, at, start)}
      data-page-anchor-only={pageAtPosition(pages, at, start + 1) === undefined}
    >
      <HighlightedText text={value} query={query} />
    </span>
  )
  return (
    <>
      {pages
        .filter((page) => page.at === at)
        .map((page) => {
          const before = text.slice(offset, page.offset)
          const beforeOffset = offset
          offset = page.offset
          return (
            <span key={page.page}>
              {sourceText(before, beforeOffset)}
              <span
                data-page-marker
                id={`page-${page.page}`}
                tabIndex={-1}
                className="relative my-3 flex scroll-mt-6 items-center justify-between border-t border-line pt-1 font-sans text-caption text-paper-muted"
              >
                <span>Page {page.page}</span>
                <span>p. {page.page}</span>
              </span>
            </span>
          )
        })}
      {sourceText(text.slice(offset), offset)}
    </>
  )
}
