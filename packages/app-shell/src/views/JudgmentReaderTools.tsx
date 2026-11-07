import { useEffect, useRef, useState } from 'react'
import { Button, Input, useToast } from '@obiter/ui'
import type { ReactNode } from 'react'
import type { readJudgmentSelection } from './judgment-selection'

type Quote = ReturnType<typeof readJudgmentSelection>

export function JudgmentReaderTools({
  children,
  name,
  citation,
  clearSearch,
  searchControl,
}: {
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
  const { toast } = useToast()
  function go(value: string) {
    const paragraph = root.current?.querySelector<HTMLElement>(
      `[id="para-${Number(value)}"]`,
    )
    if (!paragraph) {
      setError(`No paragraph ${value}`)
      return
    }
    setError('')
    paragraph.scrollIntoView({ block: 'center' })
    paragraph.focus({ preventScroll: true })
    paragraph.animate?.(
      [
        { backgroundColor: 'var(--color-brand-soft)' },
        { backgroundColor: 'transparent' },
      ],
      { duration: 1600 },
    )
  }
  useEffect(() => {
    const hash = () => {
      const match = /^#para-(\d+)$/.exec(window.location.hash)
      if (match) go(match[1] ?? '')
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
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {searchControl}
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            clearSearch()
            requestAnimationFrame(() => {
              go(number)
              if (root.current?.querySelector(`[id="para-${Number(number)}"]`))
                window.history.replaceState(null, '', `#para-${Number(number)}`)
            })
          }}
        >
          <label htmlFor="judgment-paragraph" className="text-meta text-muted">
            Go to ¶
          </label>
          <Input
            id="judgment-paragraph"
            aria-label="Go to paragraph"
            type="number"
            min="1"
            step="1"
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
