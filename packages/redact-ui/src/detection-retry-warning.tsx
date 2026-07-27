import { ArrowClockwise } from '@phosphor-icons/react'
import { Button } from '@obiter/ui'
import { DetectionModeWarning } from './detection-mode-warning'
import { useRedetectRun } from './hooks'
import type { RedactionRun } from './types'

export function DetectionRetryWarning({
  run,
  onOpenRun,
}: {
  run: RedactionRun
  onOpenRun: (runId: string) => void
}) {
  const redetect = useRedetectRun(run.id)
  const limitedDetectionMode =
    run.detectionMode === 'model+supplement' ? null : run.detectionMode
  if (!limitedDetectionMode) return null

  return (
    <div className="flex flex-col gap-2">
      <DetectionModeWarning
        detectionMode={limitedDetectionMode}
        action={
          <Button
            size="sm"
            variant="secondary"
            loading={redetect.isPending}
            iconStart={<ArrowClockwise size={16} aria-hidden="true" />}
            onClick={() =>
              redetect.mutate(undefined, {
                onSuccess: ({ run: replacement }) => onOpenRun(replacement.id),
              })
            }
          >
            {redetect.isPending
              ? 'Running model detection'
              : 'Run model detection again'}
          </Button>
        }
      />
      <p className="text-xs text-subtle">
        This creates a new run from the stored source text. This run and its
        review history remain unchanged.
      </p>
      {redetect.error ? (
        <p className="text-sm text-danger" role="alert">
          {redetect.error.message}
        </p>
      ) : null}
    </div>
  )
}
