import { Link } from '@tanstack/react-router'
import type { JudgmentParagraph } from '@obiter/contracts'
import {
  judgmentAnnotations,
  judgmentCitationTarget,
  judgmentImageUrl,
} from './judgment-annotations'
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
  paragraph,
  sourceUrl,
}: {
  paragraph?: JudgmentParagraph
  sourceUrl?: string
  text: string
  query: string
  at: number
  pages?: PlacedPage[]
}) {
  const annotations = judgmentAnnotations(text, paragraph)
  const markers = pages.filter(
    (p) =>
      p.at === at &&
      Number.isInteger(p.offset) &&
      p.offset >= 0 &&
      p.offset <= text.length,
  )
  const boundaries = [
    ...new Set([
      0,
      text.length,
      ...markers.map((p) => p.offset),
      ...annotations.footnotes.map((f) => f.offset),
      ...annotations.images.map((i) => i.offset),
      ...annotations.citations.flatMap((c) => [c.offset, c.offset + c.length]),
    ]),
  ].sort((a, b) => a - b)
  return (
    <>
      {boundaries.map((offset, index) => {
        const value = text.slice(offset, boundaries[index + 1] ?? offset)
        const citation = annotations.citations.find(
          (c) => c.offset <= offset && c.offset + c.length > offset,
        )
        const href = citation && judgmentCitationTarget(citation)
        const source = (
          <span
            data-source-text
            data-judgment-page={pageAtPosition(pages, at, offset)}
            data-page-anchor-only={
              pageAtPosition(pages, at, offset + 1) === undefined
            }
          >
            <HighlightedText text={value} query={query} />
          </span>
        )
        return (
          <span key={offset}>
            {markers
              .filter((p) => p.offset === offset)
              .map((p) => (
                <span
                  key={p.page}
                  data-page-marker
                  id={`page-${p.page}`}
                  tabIndex={-1}
                  className="relative my-3 flex scroll-mt-6 justify-between border-t border-line pt-1 font-sans text-caption text-paper-muted"
                >
                  <span>Page {p.page}</span>
                  <span>p. {p.page}</span>
                </span>
              ))}
            {annotations.footnotes
              .filter((f) => f.offset === offset)
              .map((f, i) => (
                <details
                  key={i}
                  data-judgment-note
                  className="relative inline-block select-none align-super font-sans text-caption"
                >
                  <summary
                    aria-label={`Footnote ${f.marker}`}
                    className="cursor-pointer list-none text-brand [&::-webkit-details-marker]:hidden"
                  >
                    {f.marker}
                  </summary>
                  <span className="absolute top-full left-0 z-10 block w-72 rounded border border-line bg-paper p-3 text-left text-paper-ink shadow-lg">
                    {f.text}
                  </span>
                </details>
              ))}
            {annotations.images
              .filter((image) => image.offset === offset)
              .map((image, i) => {
                const src = judgmentImageUrl(sourceUrl, image.src)
                return src ? (
                  <img
                    key={i}
                    data-judgment-image
                    src={src}
                    loading="lazy"
                    alt="Image in the judgment"
                    className="my-4 block h-auto max-w-full"
                  />
                ) : null
              })}
            {href?.startsWith('/cases/') ? (
              <Link
                to="/cases/$caseId"
                params={{ caseId: href.slice('/cases/'.length) }}
                className="text-brand underline underline-offset-2"
              >
                {source}
              </Link>
            ) : href?.startsWith('/ln/') ? (
              <Link
                to="/ln/$"
                params={{
                  _splat: href.slice('/ln/'.length).split('#')[0] ?? '',
                }}
                hash={href.split('#')[1]}
                className="text-brand underline underline-offset-2"
              >
                {source}
              </Link>
            ) : href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-brand underline underline-offset-2"
              >
                {source}
              </a>
            ) : (
              <span title={citation?.canonical}>{source}</span>
            )}
          </span>
        )
      })}
    </>
  )
}
