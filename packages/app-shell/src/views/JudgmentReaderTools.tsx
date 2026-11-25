import { judgmentTarget } from './judgment-pages'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, useToast } from '@obiter/ui'
import type { ReactNode } from 'react'
import { readJudgmentSelection } from './judgment-selection'

type Quote = ReturnType<typeof readJudgmentSelection>

function jumpToJudgmentTarget(target: HTMLElement) {
  target.scrollIntoView({ block: 'start' })
  target.focus({ preventScroll: true })
  target.animate?.(
    [
      { backgroundColor: 'var(--color-brand-soft)' },
      { backgroundColor: 'transparent' },
    ],
    { duration: 1600 },
  )
}

export function JudgmentReaderTools({
  children,
  name,
  citation,
  clearSearch,
  searchControl,
  onInlineArrival,
}: {
  onInlineArrival?: (id: string | null) => void
  searchControl?: ReactNode
  children: ReactNode
  name: string
  citation: string | null
  clearSearch: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [number, setNumber] = useState('')
  const [error, setError] = useState('')
  const [quote, setQuote] = useState<Quote>(null)
  const [arrival, setArrival] = useState<{ target: HTMLElement } | null>(null)
  const { toast } = useToast()
  function go(value: string, fromLink = false) {
    const paragraph = root.current?.querySelector<HTMLElement>(
      `[id="${judgmentTarget(value)}"]`,
    )
    const inline =
      fromLink && paragraph?.closest('[data-judgment-notices-inline]')
    onInlineArrival?.(inline && paragraph ? paragraph.id : null)
    if (!paragraph) {
      setArrival(null)
      setError(
        `No ${value.startsWith('p.') ? 'page' : 'paragraph'} ${value.replace(/^p\.\s*/, '')}`,
      )
      return
    }
    setError('')
    if (
      (inline && onInlineArrival) ||
      root.current?.querySelector('[data-judgment-arrival-notices]')
    ) {
      setArrival({ target: paragraph })
    } else jumpToJudgmentTarget(paragraph)
  }
  useLayoutEffect(() => {
    if (!arrival) return
    const notices = root.current?.querySelector<HTMLElement>(
      '[data-judgment-arrival-notices]',
    )
    const { target } = arrival
    if (!notices) {
      jumpToJudgmentTarget(target)
      return
    }
    const previousMargin = target.style.scrollMarginTop
    const updateMargin = () => {
      const noticeRect = notices.getBoundingClientRect()
      target.style.scrollMarginTop = noticeRect.height
        ? `${target.getBoundingClientRect().top - noticeRect.top}px`
        : previousMargin
    }
    updateMargin()
    jumpToJudgmentTarget(target)
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updateMargin)
    observer?.observe(notices)
    return () => {
      observer?.disconnect()
      target.style.scrollMarginTop = previousMargin
    }
  }, [arrival])
  useEffect(() => {
    const hash = () => {
      const match = /^#(para|page)-(\d+)$/.exec(window.location.hash)
      if (match) go(`${match[1] === 'page' ? 'p. ' : ''}${match[2]}`, true)
      else {
        onInlineArrival?.(null)
        setArrival(null)
      }
    }
    hash()
    window.addEventListener('hashchange', hash)
    let active = true
    let revision = 0
    const selection = async () => {
      const current = ++revision
      const tools = await import('./judgment-selection')
      if (active && current === revision && root.current)
        setQuote(tools.readJudgmentSelection(root.current))
    }
    const dismiss = () => setQuote(null)
    document.addEventListener('selectionchange', selection)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      active = false
      window.removeEventListener('hashchange', hash)
      document.removeEventListener('selectionchange', selection)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [])
  async function copy() {
    if (!quote) return
    try {
      const tools = await import('./judgment-selection')
      await tools.copyJudgmentSelection(name, citation, quote)
      toast({ title: 'Copied' })
      setQuote(null)
    } catch {
      toast({
        title: 'Could not copy',
        description: 'Check clipboard permissions and try again.',
      })
    }
  }
  return (
    <div
      ref={root}
      className="flex min-w-0 flex-col gap-4"
      onCopy={(event) => {
        const clipboard = event.clipboardData
        const selection = window.getSelection()
        if (!selection?.rangeCount || !root.current) return
        const range = selection.getRangeAt(0)
        if (
          !Array.from(
            root.current.querySelectorAll('[data-judgment-note]'),
          ).some((note) => range.intersectsNode(note))
        )
          return
        event.preventDefault()
        const selected = readJudgmentSelection(root.current)
        if (selected) clipboard.setData('text/plain', selected.text)
      }}
    >
      <div className="flex flex-wrap items-center gap-3">
        {searchControl}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            clearSearch()
            requestAnimationFrame(() => {
              go(number)
              if (
                root.current?.querySelector(`[id="${judgmentTarget(number)}"]`)
              )
                window.history.replaceState(
                  null,
                  '',
                  `#${judgmentTarget(number)}`,
                )
            })
          }}
        >
          <label htmlFor="judgment-paragraph" className="text-meta text-muted">
            Go to ¶
          </label>
          <Input
            id="judgment-paragraph"
            aria-label="Go to paragraph"
            type="text"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            className="w-24"
          />
          <span role="status" className="text-meta text-muted">
            {error}
          </span>
        </form>
      </div>
      {children}
      {quote ? (
        <div
          className="fixed z-50"
          style={{ left: quote.left, top: quote.top }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <Button onClick={() => void copy()}>Copy quote with citation</Button>
        </div>
      ) : null}
    </div>
  )
}
