import { Card, CardBody, CardHead } from '@obiter/ui'
import type {
  JudgmentCover as Cover,
  JudgmentCoverLine,
  JudgmentHeading,
  JudgmentParagraph,
} from '@obiter/contracts'
import { JudgmentPageText } from './JudgmentPageText'
import { JudgmentParagraphActions } from './JudgmentParagraphActions'
import { pageAtPosition, type PlacedPage } from './judgment-pages'
import {
  opinionTitle,
  startsCourtParagraph,
  type Opinion,
} from './judgment-structure'

const indents = ['', 'ml-8', 'ml-16', 'ml-24', 'ml-32', 'ml-40']

function sentenceCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()
}

const coverLineClass = {
  term: 'text-meta uppercase tracking-[0.12em] text-paper-muted',
  citation: 'text-[18px] font-semibold',
  appeal: 'text-meta italic text-paper-muted',
  title: 'mt-6 text-[20px] leading-snug',
  label:
    'mt-6 font-sans text-caption uppercase tracking-[0.16em] text-paper-muted',
  judge: 'text-body',
  date: 'text-body font-semibold',
  heard: 'mt-4 text-meta text-paper-muted',
  text: 'max-w-[60ch] text-meta text-paper-muted',
} satisfies Record<JudgmentCoverLine['kind'], string>

function CoverLine({ line }: { line: JudgmentCoverLine }) {
  if (line.kind === 'title' && line.parties)
    return (
      <div className={coverLineClass.title}>
        {line.parties.map((party, index) => (
          <div key={index}>
            {index > 0 ? (
              <span className="my-2 block italic text-paper-muted">v</span>
            ) : null}
            <span className="block">{party.name}</span>
            {party.role ? (
              <span className="block text-meta text-paper-muted">
                ({party.role})
              </span>
            ) : null}
          </div>
        ))}
      </div>
    )
  return (
    <p className={coverLineClass[line.kind]}>
      {line.kind === 'label' ? sentenceCase(line.text) : line.text}
    </p>
  )
}

export function JudgmentCover({ cover }: { cover: Cover }) {
  const [head, ...rows] = cover.counsel ?? []
  return (
    <header
      aria-label="Front page"
      className="mb-10 flex flex-col items-center gap-1 border-b border-line pb-10 text-center"
    >
      {cover.lines.map((line, index) => (
        <CoverLine key={index} line={line} />
      ))}
      {head ? (
        <table
          aria-label="Counsel"
          className="mt-8 w-full max-w-xl table-fixed text-center font-sans text-meta"
        >
          <thead>
            <tr>
              {head.map((cell, index) => (
                <th
                  key={index}
                  className="px-2 pb-2 font-normal italic text-paper-muted"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column} className="px-2 py-0.5 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </header>
  )
}

function Heading({ heading, id }: { heading: JudgmentHeading; id?: string }) {
  if (heading.kind === 'section')
    return (
      <h3 className="mt-6 font-sans text-meta font-semibold text-paper-ink">
        {heading.text}
      </h3>
    )
  const { name, note } = opinionTitle(heading.text)
  return (
    <div
      id={id}
      tabIndex={-1}
      data-opinion-heading
      className="mt-10 mb-2 flex scroll-mt-6 flex-col items-center gap-1 border-t border-line pt-6 text-center font-sans first:mt-0 first:border-t-0 first:pt-0"
    >
      <h2 className="text-item text-paper-ink">{name}</h2>
      {note ? <p className="text-meta text-paper-muted">{note}</p> : null}
    </div>
  )
}

export function OpinionsCard({ opinions }: { opinions: Opinion[] }) {
  return (
    <Card>
      <CardHead title="Opinions" />
      <CardBody>
        <ol className="flex flex-col gap-2 text-meta">
          {opinions.map((opinion) => (
            <li key={opinion.id}>
              <a
                href={`#${opinion.id}`}
                className="flex justify-between gap-3 text-ink underline-offset-2 hover:underline"
              >
                <span>{opinion.name}</span>
                <span className="shrink-0 text-subtle tabular-nums">
                  {opinion.first === opinion.last
                    ? `[${opinion.first}]`
                    : `[${opinion.first}]–[${opinion.last}]`}
                </span>
              </a>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  )
}

export function JudgmentEntry({
  paragraph,
  previous,
  at,
  owner,
  showNumbers,
  showHeadings,
  opinionId,
  courtText,
  pages,
  query,
  name,
  citation,
}: {
  paragraph: JudgmentParagraph
  previous: JudgmentParagraph | undefined
  at: number
  owner: boolean
  showNumbers: boolean
  showHeadings: boolean
  opinionId: string | undefined
  courtText: string
  pages: PlacedPage[] | undefined
  query: string
  name: string
  citation: string | null
}) {
  const starts = startsCourtParagraph(paragraph, previous)
  const number = showNumbers && starts ? String(paragraph.paragraphNumber) : ''
  const label = !starts ? paragraph.label : undefined
  const level = paragraph.level ?? 1
  const opinionHeading = paragraph.headings
    ?.filter((heading) => heading.kind === 'opinion')
    .at(-1)
  const Element = paragraph.style === 'table' ? 'div' : 'p'
  return (
    <>
      {showHeadings
        ? paragraph.headings?.map((heading, index) => (
            <Heading
              key={index}
              heading={heading}
              id={heading === opinionHeading ? opinionId : undefined}
            />
          ))
        : null}
      <Element
        className={`grid scroll-mt-6 grid-cols-[34px_minmax(0,1fr)] gap-3 text-[16px] leading-[1.8] ${indents[level - 1] ?? indents.at(-1)}`}
        tabIndex={-1}
        data-court-paragraph={
          showNumbers ? paragraph.paragraphNumber : undefined
        }
        data-judgment-page={pageAtPosition(pages, at)}
        id={number && owner ? `para-${number}` : undefined}
      >
        <span
          data-paragraph-gutter
          aria-label={number ? `Paragraph ${number}` : undefined}
          className="select-none pt-1 text-right font-sans text-meta text-paper-muted tabular-nums"
        >
          {number ? (
            <JudgmentParagraphActions
              page={pageAtPosition(pages, at)}
              number={paragraph.paragraphNumber}
              text={courtText}
              name={name}
              citation={citation}
            />
          ) : label ? (
            <span data-quote-label={label}>{label}</span>
          ) : null}
        </span>
        {paragraph.style === 'table' && paragraph.cells ? (
          <table className="w-full border-collapse font-sans text-meta">
            <tbody>
              {paragraph.cells.map((row, index) => (
                <tr key={index} className="border-b border-line">
                  {row.map((cell, column) => (
                    <td key={column} className="px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <span
            className={
              paragraph.style === 'quote'
                ? 'pl-6 text-[15px] leading-[1.7]'
                : undefined
            }
          >
            <JudgmentPageText
              text={pages ? paragraph.text : paragraph.text.trim()}
              query={query}
              at={at}
              pages={pages}
            />
          </span>
        )}
      </Element>
    </>
  )
}
