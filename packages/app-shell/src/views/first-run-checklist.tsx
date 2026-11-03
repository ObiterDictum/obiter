import { Link } from '@tanstack/react-router'
import { Button, buttonClassName } from '@obiter/ui'
import { CheckCircle } from '@obiter/ui/icons'
import {
  firstRunProgress,
  type FirstRunStep,
  type FirstRunStepId,
} from '../first-run-checklist'
import { CreateMatterDialog } from './create-matter-dialog'

export function FirstRunChecklist({
  steps,
  showOrganisationSettings,
  onDismiss,
}: {
  steps: FirstRunStep[]
  showOrganisationSettings: boolean
  onDismiss: () => void
}) {
  const { done, total } = firstRunProgress(steps)
  const remaining = steps.filter((step) => !step.done)
  const completed = steps.filter((step) => step.done)

  return (
    <section aria-labelledby="first-run">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="first-run" className="text-section text-ink">
          Getting started
        </h2>
        <span className="text-meta text-subtle tabular-nums">
          {done} of {total} done
        </span>
      </div>

      <div className="rounded-lg bg-surface">
        <ol role="list" className="list-none">
          {remaining.map((step) => (
            <li
              key={step.id}
              className="flex flex-wrap items-center gap-4 px-6 py-4 [&+li]:border-t [&+li]:border-line"
            >
              <span
                aria-hidden="true"
                className="size-5 shrink-0 rounded-pill border border-line-strong"
              />
              <div className="min-w-0 grow basis-[min(100%,20rem)]">
                <h3 className="text-item text-ink">{step.title}</h3>
                <p className="mt-1 max-w-[60ch] text-meta text-muted">
                  {step.description}
                </p>
              </div>
              <div className="shrink-0">{stepAction(step.id)}</div>
            </li>
          ))}
        </ol>
        {completed.length > 0 ? (
          <p className="flex items-center gap-3 border-t border-line px-6 py-3 text-meta text-muted">
            <CheckCircle
              size={18}
              aria-hidden="true"
              className="shrink-0 text-success"
            />
            <span>
              <span className="sr-only">Done: </span>
              {completed.map((step) => step.title).join(' · ')}
            </span>
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-3">
          {showOrganisationSettings ? (
            <Link
              to="/settings"
              className="text-meta text-muted hover:text-ink"
            >
              Review your organisation settings
            </Link>
          ) : (
            <span className="text-meta text-subtle">
              Steps tick from the work already stored here.
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Hide checklist
          </Button>
        </div>
      </div>
    </section>
  )
}

function stepAction(id: FirstRunStepId) {
  switch (id) {
    case 'invite':
      return (
        <Link
          to="/settings"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Invite in Settings
        </Link>
      )
    case 'matter':
      return (
        <CreateMatterDialog
          trigger="New matter"
          variant="secondary"
          size="sm"
        />
      )
    case 'upload':
      return (
        <Link
          to="/matters"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Choose a matter
        </Link>
      )
    case 'verify':
      return (
        <Link
          to="/verify"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Open Verify
        </Link>
      )
    case 'search':
      return (
        <Link
          to="/search"
          className={buttonClassName({ variant: 'secondary', size: 'sm' })}
        >
          Open Search
        </Link>
      )
    default: {
      const unhandled: never = id
      return unhandled
    }
  }
}
