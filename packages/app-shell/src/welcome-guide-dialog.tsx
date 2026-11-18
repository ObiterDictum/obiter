import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { MeResponse, WelcomeGuideState } from '@obiter/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useRef, useState, type KeyboardEvent } from 'react'
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
  cn,
  useToast,
} from '@obiter/ui'
import { apiFetch } from './api'
import { useIsMacPlatform } from './keyboard-platform'
import { welcomeSteps } from './welcome-guide-steps'

export default function WelcomeGuideDialog({
  onClose,
  unseenUserId,
}: {
  onClose: () => void
  unseenUserId?: string
}) {
  const steps = welcomeSteps(useIsMacPlatform())
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const markSeen = useMutation({
    mutationFn: (_userId: string) =>
      apiFetch<WelcomeGuideState>('/api/me/welcome-guide', { method: 'POST' }),
    retry: 2,
    onSuccess: (welcomeGuide, userId) => {
      queryClient.setQueryData<MeResponse>(['current-user'], (current) =>
        current?.user.id === userId ? { ...current, welcomeGuide } : current,
      )
    },
    onError: () =>
      toast({
        title: 'Could not save your welcome guide preference',
        description: 'The guide may appear again when you next sign in.',
      }),
  })
  const [at, setAt] = useState(0)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const step = steps[at]
  if (!step) throw new Error('The welcome guide has no steps')
  const last = at === steps.length - 1

  function go(index: number) {
    setAt(Math.min(Math.max(index, 0), steps.length - 1))
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === 'ArrowRight') go(at + 1)
    else if (event.key === 'ArrowLeft') go(at - 1)
    else return
    event.preventDefault()
  }

  function close() {
    if (unseenUserId) markSeen.mutate(unseenUserId)
    onClose()
  }

  function finish() {
    close()
    void navigate({ to: '/' })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close()
      }}
    >
      <DialogContent size="md" initialFocus={primaryRef} className="p-0">
        <div onKeyDown={onKeyDown} className="flex flex-col">
          <DialogCloseButton />
          <div className="flex flex-col gap-5 px-6 pt-8 pb-6 sm:px-8">
            <div
              aria-hidden
              className="grid size-14 place-items-center rounded-lg bg-brand-soft text-brand"
            >
              {step.art}
            </div>
            <div aria-live="polite" className="flex flex-col gap-1">
              <p className="text-caption text-subtle tabular-nums">
                Step {at + 1} of {steps.length}
              </p>
              <DialogTitle className="mb-0">{step.title}</DialogTitle>
            </div>
            <div className="sm:min-h-36">{step.body}</div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-line px-6 py-4 sm:px-8">
            <ol aria-label="Guide steps" className="flex items-center">
              {steps.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={`Step ${index + 1}: ${item.title}`}
                    aria-current={index === at ? 'step' : undefined}
                    onClick={() => go(index)}
                    className="group grid size-6 place-items-center rounded-pill focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span
                      className={cn(
                        'block size-2 rounded-pill transition-colors',
                        index === at
                          ? 'bg-brand'
                          : 'bg-line-strong group-hover:bg-muted',
                      )}
                    />
                  </button>
                </li>
              ))}
            </ol>
            <div className="ml-auto flex items-center gap-2">
              {last ? null : (
                <Button variant="ghost" onClick={close}>
                  Skip
                </Button>
              )}
              {at > 0 ? (
                <Button variant="secondary" onClick={() => go(at - 1)}>
                  Back
                </Button>
              ) : null}
              <Button
                ref={primaryRef}
                onClick={last ? finish : () => go(at + 1)}
              >
                {last ? 'Get started' : 'Next'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
