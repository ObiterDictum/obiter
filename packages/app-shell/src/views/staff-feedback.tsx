import { StaffGate } from './staff-gate'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Badge, Button, Skeleton } from '@obiter/ui'
import type { BadgeTone } from '@obiter/ui'
import type { StaffFeedbackItem } from '@obiter/contracts'
import { formatDateTime } from '../format'
import { PageScaffold } from '../page-scaffold'
import { SegmentedControl } from '../segmented-control'
import {
  staffFeedbackHandledMutationOptions,
  staffFeedbackQueryOptions,
  validateStaffFeedbackSearch,
} from '../staff'
import { ErrorNotice } from './settings-fields'

const KIND_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'problem', label: 'Problem' },
  { value: 'idea', label: 'Idea' },
  { value: 'question', label: 'Question' },
] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'handled', label: 'Handled' },
  { value: 'all', label: 'All' },
] as const

const KIND_LABELS = {
  problem: 'Problem',
  idea: 'Idea',
  question: 'Question',
} as const

const KIND_TONES = {
  problem: 'warning',
  idea: 'info',
  question: 'neutral',
} as const satisfies Record<StaffFeedbackItem['kind'], BadgeTone>

export function StaffFeedbackRouteView() {
  return (
    <StaffGate>
      <StaffFeedback />
    </StaffGate>
  )
}

function StaffFeedback() {
  const navigate = useNavigate()
  const searchStr = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const filters = validateStaffFeedbackSearch(
    Object.fromEntries(new URLSearchParams(searchStr)),
  )
  const kind = filters.kind ?? 'all'
  const status = filters.status
  const feedback = useQuery(staffFeedbackQueryOptions(filters))
  const handled = useMutation(staffFeedbackHandledMutationOptions())
  const setKind = (value: string) => {
    const kind =
      value === 'problem' || value === 'idea' || value === 'question'
        ? value
        : undefined
    void navigate({
      to: '/staff/feedback',
      search: { status, ...(kind ? { kind } : {}) },
    })
  }
  const setStatus = (value: string) => {
    const next = value === 'handled' || value === 'all' ? value : 'open'
    void navigate({
      to: '/staff/feedback',
      search: {
        status: next,
        ...(filters.kind ? { kind: filters.kind } : {}),
      },
    })
  }
  return (
    <PageScaffold
      title="Feedback"
      description="Messages sent from inside the app, newest first."
    >
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<string>
          label="Feedback kind"
          value={kind}
          options={[...KIND_OPTIONS]}
          onChange={setKind}
        />
        <SegmentedControl<string>
          label="Feedback status"
          value={status}
          options={[...STATUS_OPTIONS]}
          onChange={setStatus}
        />
      </div>
      {feedback.isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : feedback.isError ? (
        <ErrorNotice message="Could not load feedback." />
      ) : feedback.data.feedback.length === 0 ? (
        <p className="text-meta text-muted">No feedback to show.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {feedback.data.feedback.map((item) => (
            <FeedbackItem
              key={item.id}
              item={item}
              pending={handled.isPending && handled.variables?.id === item.id}
              onToggle={() =>
                handled.mutate({ id: item.id, handled: !item.handledAt })
              }
            />
          ))}
        </ul>
      )}
    </PageScaffold>
  )
}

function FeedbackItem({
  item,
  pending,
  onToggle,
}: {
  item: StaffFeedbackItem
  pending: boolean
  onToggle: () => void
}) {
  const meta = [
    item.organisationName,
    item.path,
    item.appVersion,
    item.platform,
  ].filter((part): part is string => Boolean(part))
  return (
    <li className="flex flex-col gap-3 rounded-lg bg-surface p-5 @pane-wide:flex-row @pane-wide:items-start @pane-wide:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={KIND_TONES[item.kind]}>{KIND_LABELS[item.kind]}</Badge>
          <span className="text-caption text-subtle">
            {formatDateTime(item.createdAt)}
          </span>
        </div>
        <p className="mt-2 text-body whitespace-pre-wrap text-ink">
          {item.message}
        </p>
        <p className="mt-2 text-meta text-muted">
          {item.senderName} · {item.senderEmail}
        </p>
        {meta.length > 0 ? (
          <p className="mt-1 text-caption break-all text-subtle">
            {meta.join(' · ')}
          </p>
        ) : null}
        {item.handledAt ? (
          <p className="mt-1 text-caption text-subtle">
            Handled by {item.handledByName ?? 'a staff member'} ·{' '}
            {formatDateTime(item.handledAt)}
          </p>
        ) : null}
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0 self-start"
        loading={pending}
        onClick={onToggle}
      >
        {item.handledAt ? 'Reopen' : 'Mark handled'}
      </Button>
    </li>
  )
}
