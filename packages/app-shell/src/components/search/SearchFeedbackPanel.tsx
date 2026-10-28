import { Button, Card, CardBody } from '@obiter/ui'

interface SearchFeedbackPanelProps {
  action?: {
    label: string
    onClick: () => void
  }
  body: string
  eyebrow: string
  title: string
  tone?: 'neutral' | 'warning' | 'error'
}

export function SearchFeedbackPanel({
  action,
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
      </CardBody>
    </Card>
  )
}
