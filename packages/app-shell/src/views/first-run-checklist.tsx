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

  return (
    <section aria-labelledby="first-run">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 id="first-run" className="text-section text-ink">
          Getting started
        </h2>
        <span className="text-meta text-subtle tabular-nums">
          {done} of {total} done
        </span>
      </div>

      <div className="rounded-lg bg-surface">
        <ol role="list" className="list-none">
          {steps.map((step) => (
            <li
              key={`${step.id}:${step.title}`}
              className="flex flex-wrap items-center gap-4 px-6 py-4 [&+li]:border-t [&+li]:border-line"
            >
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? 'grid size-5 shrink-0 place-items-center text-success'
                    : 'size-5 shrink-0 rounded-pill border border-line-strong'
                }
              >
                {step.done ? <CheckCircle size={20} /> : null}
              </span>
              <div className="min-w-0 flex-1">
                <h3
                  className={
                    step.done ? 'text-item text-muted' : 'text-item text-ink'
                  }
                >
                  {step.title}
                </h3>
                <p className="mt-1 max-w-[60ch] text-meta text-muted">
                  {step.description}
                </p>
              </div>
              <span className="sr-only">
                {step.done ? 'Done' : 'Not done yet'}
              </span>
              {step.done ? null : (
                <div className="shrink-0">{stepAction(step.id)}</div>
              )}
            </li>
          ))}
        </ol>

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
