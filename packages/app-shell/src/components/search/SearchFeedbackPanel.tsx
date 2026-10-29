import { Button, Card, CardBody } from '@obiter/ui'

interface SearchFeedbackPanelProps {
  action?: {
    label: string
    onClick: () => void
  }
  searchLinks?: Array<{ label: string; href: string }>
  body: string
  eyebrow: string
  title: string
  tone?: 'neutral' | 'warning' | 'error'
}

export function SearchFeedbackPanel({
  action,
  searchLinks = [],
  body,
  eyebrow,
  title,
  tone = 'neutral',
}: SearchFeedbackPanelProps) {
  return (
    <Card
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      className="mx-auto max-w-[680px]"
    >
      <CardBody className="flex flex-col gap-2 pt-6">
        <p className="text-caption text-subtle">{eyebrow}</p>
        <h2 className="text-section text-ink">{title}</h2>
        <p className="max-w-[68ch] text-body text-muted">{body}</p>
        {action ? (
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        ) : null}
        {searchLinks.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3">
            <p className="text-caption text-subtle">
              Search the public sources
            </p>
            {searchLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex w-fit items-center gap-1 text-meta text-ink underline-offset-2 hover:underline"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}
