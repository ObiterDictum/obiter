import { Link } from '@tanstack/react-router'
import { buttonClassName } from '@obiter/ui'
import { ArrowUpRight } from '@obiter/ui/icons'

export function SourcePageLinks({ sourceUrl }: { sourceUrl: string }) {
  return (
    <>
      <a
        className={buttonClassName({ variant: 'secondary', size: 'md' })}
        href={sourceUrl}
        target="_blank"
        rel="noreferrer noopener"
      >
        Open original
        <ArrowUpRight aria-hidden size={14} />
      </a>
      <Link
        className={buttonClassName({ variant: 'ghost', size: 'md' })}
        to="/search"
      >
        Back to search
      </Link>
    </>
  )
}
