import './LegislationActReader.css'
import { apiUrl } from '../lib/api-url'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Link, createLink } from '@tanstack/react-router'
import { Button } from '@obiter/ui'
import {
  legislationActTextPageSize,
  legislationActTextPageSchema,
  type LegislationProvisionWording,
} from '@obiter/contracts/legislation-reader'
import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import { provisionResultLocation } from '../legislation-navigation'
import {
  type LegislationActContentsNode,
  type LegislationActDocument,
} from './legislation-document-query'
import { LegislationProvisionBody } from './LegislationProvisionBody'

async function fetchLegislationActTextPage(
  identity: string,
  offset: number,
  signal: AbortSignal,
) {
  const response = await fetch(
    apiUrl(
      `/api/search/legislation/${identity}/text?offset=${offset}&limit=${legislationActTextPageSize}`,
    ),
    { signal },
  )
  if (!response.ok) throw new Error('Act wording could not be loaded.')
  return legislationActTextPageSchema.parse(await response.json())
}

const ContentsLink = createLink(function ContentsAnchor({
  readingPosition,
  ...props
}: ComponentProps<'a'> & { readingPosition?: boolean }) {
  return (
    <a {...props} aria-current={readingPosition ? 'location' : undefined} />
  )
})

interface ContentsEntry {
  node: LegislationActContentsNode
  anchor: string
  depth: number
}

function flattenContents(
  nodes: LegislationActContentsNode[],
  depth = 0,
): ContentsEntry[] {
  return nodes.flatMap((node) => [
    { node, anchor: node.labelPath.replaceAll('/', '-'), depth },
    ...flattenContents(node.children, depth + 1),
  ])
}

function entryLabel({ node }: ContentsEntry) {
  const title = node.heading || node.text
  return title && title !== node.label ? `${node.label} · ${title}` : node.label
}

function focusHeading(heading: HTMLElement) {
  heading.scrollIntoView({ block: 'start' })
  heading.focus({ preventScroll: true })
}

export function LegislationActReader({
  act,
  hash,
}: {
  act: LegislationActDocument
  hash: string
}) {
  const entries = flattenContents(act.contents).sort((a, b) => {
    if (a.node.docOrder === undefined || b.node.docOrder === undefined) return 0
    return (
      a.node.docOrder - b.node.docOrder ||
      (a.node.labelPath < b.node.labelPath
        ? -1
        : a.node.labelPath === b.node.labelPath
          ? 0
          : 1)
    )
  })
  const index = entries.findIndex((entry) => entry.anchor === hash)
  const offset =
    Math.floor(Math.max(0, index) / legislationActTextPageSize) *
    legislationActTextPageSize
  return (
    <ActReaderPages
      act={act}
      key={offset}
      entries={entries}
      offset={offset}
      target={index >= 0 ? hash : ''}
    />
  )
}

function ActReaderPages({
  act,
  entries,
  offset,
  target,
}: {
  act: LegislationActDocument
  entries: ContentsEntry[]
  offset: number
  target: string
}) {
  const [contentsOpen, setContentsOpen] = useState(false)
  const [active, setActive] = useState<string | undefined>(
    target || entries[offset]?.anchor,
  )
  const [text, setText] = useState<HTMLDivElement | null>(null)
  const query = useInfiniteQuery({
    queryKey: ['legislation-act-text', act.identity, offset],
    initialPageParam: offset,
    queryFn: ({ pageParam, signal }) =>
      fetchLegislationActTextPage(act.identity, pageParam, signal),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    getPreviousPageParam: (_, __, pageOffset) =>
      pageOffset > 0
        ? Math.max(0, pageOffset - legislationActTextPageSize)
        : undefined,
    retry: 1,
  })
  const pages = query.data?.pages
  const entriesByPath = new Map(
    entries.map((entry) => [entry.node.labelPath, entry]),
  )
  const targetMissing = Boolean(
    target &&
    pages &&
    !pages.some((page) =>
      page.entries.some(
        ({ labelPath }) => entriesByPath.get(labelPath)?.anchor === target,
      ),
    ),
  )
  const jumpRef = useCallback((heading: HTMLHeadingElement | null) => {
    if (heading) focusHeading(heading)
  }, [])
  const activeLinkRef = useCallback((link: HTMLAnchorElement | null) => {
    const nav = link?.closest('nav')
    if (!nav || !link || !nav.clientHeight) return
    const linkBox = link.getBoundingClientRect()
    const navBox = nav.getBoundingClientRect()
    nav.scrollTop +=
      Math.min(0, linkBox.top - navBox.top) +
      Math.max(0, linkBox.bottom - navBox.bottom)
  }, [])
  const nextPage = useCallback(
    (button: HTMLButtonElement | null) => {
      if (!button || typeof IntersectionObserver === 'undefined') return
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting)
            void query.fetchNextPage({ cancelRefetch: false })
        },
        { rootMargin: '0px 0px 240px' },
      )
      observer.observe(button)
      return () => observer.disconnect()
    },
    [query.fetchNextPage],
  )

  useEffect(() => {
    if (!text || typeof IntersectionObserver === 'undefined') return
    const visible = new Set<string>()
    const observer = new IntersectionObserver((changes) => {
      for (const change of changes) {
        const anchor = change.target.getAttribute('aria-labelledby')
        if (!anchor) continue
        if (change.isIntersecting) visible.add(anchor)
        else visible.delete(anchor)
      }
      const first = Array.from(
        text.querySelectorAll(':scope > [aria-labelledby]'),
      ).find((section) =>
        visible.has(section.getAttribute('aria-labelledby') ?? ''),
      )
      if (first) setActive(first.getAttribute('aria-labelledby') ?? undefined)
    })
    for (const section of text.querySelectorAll(':scope > [aria-labelledby]'))
      observer.observe(section)
    return () => observer.disconnect()
  }, [text, pages])

  return (
    <div className="act-reader">
      <aside className="act-reader-sidebar rounded-lg border border-line bg-surface">
        <button
          type="button"
          aria-expanded={contentsOpen}
          aria-controls="act-contents"
          onClick={() => setContentsOpen(!contentsOpen)}
          className="act-reader-toggle w-full p-3 text-left text-item"
        >
          Contents
        </button>
        <nav
          id="act-contents"
          aria-label="Act contents"
          data-open={contentsOpen}
          className="act-reader-contents p-3"
        >
          <h2 className="act-reader-contents-heading mb-2 text-item">
            Contents
          </h2>
          <ol>
            {entries.map((entry) => (
              <li
                key={entry.anchor}
                style={{
                  marginInlineStart: `${Math.min(entry.depth, 4) * 0.7}rem`,
                }}
              >
                <ContentsLink
                  {...provisionResultLocation({
                    documentIdentity: act.identity,
                    labelPath: '',
                  })}
                  ref={entry.anchor === active ? activeLinkRef : undefined}
                  hash={entry.anchor}
                  hashScrollIntoView={false}
                  resetScroll={false}
                  preload={false}
                  readingPosition={active === entry.anchor}
                  className="block rounded-sm px-2 py-1 text-meta text-muted hover:bg-hover"
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.ctrlKey ||
                      event.metaKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return
                    setContentsOpen(false)
                    if (entry.anchor === target) {
                      const heading = document.getElementById(target)
                      if (heading) focusHeading(heading)
                    }
                  }}
                >
                  {entryLabel(entry)}
                </ContentsLink>
              </li>
            ))}
          </ol>
        </nav>
      </aside>
      <section
        aria-label="Act text"
        className="min-w-0 space-y-4"
        aria-busy={query.isFetching}
      >
        {query.hasPreviousPage ? (
          <Button
            variant="secondary"
            onClick={() => void query.fetchPreviousPage()}
            disabled={query.isFetching}
          >
            {query.isFetchingPreviousPage
              ? 'Loading preceding Act text…'
              : 'Load preceding Act text'}
          </Button>
        ) : null}
        {targetMissing ? (
          <p role="status" className="text-meta text-muted">
            The requested heading is missing from this page. Reload the Act or
            follow the official source.
          </p>
        ) : null}
        {query.isPending ? <p role="status">Loading Act text…</p> : null}
        {query.isError ? (
          <div role="alert" className="space-y-2 text-meta">
            <p>This part of the Act could not be loaded.</p>
            <Button
              variant="secondary"
              onClick={() => {
                if (query.isFetchNextPageError) void query.fetchNextPage()
                else if (query.isFetchPreviousPageError)
                  void query.fetchPreviousPage()
                else void query.refetch()
              }}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {pages && pages[0]?.entries.length === 0 ? (
          <p className="text-meta text-muted">
            No stored text is available here. Read the official Act for the
            wording.
          </p>
        ) : null}
        <div
          ref={setText}
          className="act-reader-paper flex flex-col gap-6 rounded-lg bg-paper px-5 py-8 text-paper-ink shadow-md"
        >
          {pages
            ?.flatMap((page) => page.entries)
            .map(({ labelPath, provision }) => {
              const entry = entriesByPath.get(labelPath)
              return entry ? (
                <ActTextEntry
                  key={labelPath}
                  act={act}
                  entry={entry}
                  provision={provision}
                  headingRef={entry.anchor === target ? jumpRef : undefined}
                />
              ) : null
            })}
        </div>
        {query.hasNextPage && !query.isError ? (
          <Button
            ref={query.isFetching ? undefined : nextPage}
            variant="secondary"
            onClick={() => void query.fetchNextPage()}
            disabled={query.isFetching}
          >
            {query.isFetchingNextPage
              ? 'Loading more Act text…'
              : 'Load more Act text'}
          </Button>
        ) : null}
      </section>
    </div>
  )
}

function ActTextEntry({
  act,
  entry,
  provision,
  headingRef,
}: {
  act: LegislationActDocument
  entry: ContentsEntry
  provision?: LegislationProvisionWording
  headingRef?: (heading: HTMLHeadingElement | null) => void
}) {
  const Heading =
    (['h2', 'h3', 'h4', 'h5', 'h6'] as const)[Math.min(entry.depth, 4)] ?? 'h6'
  return (
    <div aria-labelledby={entry.anchor} className="flex flex-col gap-3">
      <Heading
        id={entry.anchor}
        ref={headingRef}
        tabIndex={-1}
        className={`scroll-mt-5 font-serif ${provision ? 'text-item' : 'text-section'}`}
      >
        {entryLabel(entry)}
      </Heading>
      {provision ? (
        <>
          <LegislationProvisionBody
            provision={provision}
            documentIdentity={act.identity}
            provisionLabel={entry.node.label}
            title={act.title}
            heading={entry.node.heading}
          />
          <div className="flex flex-wrap gap-4 border-b border-line pb-4 text-caption text-paper-muted">
            <Link
              {...provisionResultLocation({
                documentIdentity: act.identity,
                labelPath: entry.node.labelPath,
                canonicalUrl: provision.canonicalUrl,
              })}
              aria-label={`Open provision ${entry.node.label}`}
              className="underline underline-offset-2"
            >
              Open provision
            </Link>
            {provision.legislationStatus === 'current' ? (
              <a
                href={provision.officialUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2"
              >
                legislation.gov.uk
              </a>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
