import { useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  useToast,
} from '@obiter/ui'
import {
  staffDecisionResponseSchema,
  type StaffDecision,
  type StaffDecisionInput,
} from '@obiter/contracts'
import { apiFetch } from '../api'
import { PageScaffold } from '../page-scaffold'
import { SegmentedControl } from '../segmented-control'
import { ShellNotFound } from '../shell-states'
import { useCurrentUser } from '../current-user'
import { formatDateTime } from '../format'
import {
  staffQueueQueryOptions,
  staffDecisionsQueryOptions,
  staffOrganisationsQueryOptions,
} from '../staff'
import { ErrorNotice } from './settings-fields'
import { AccessQueue } from './staff-queue'

const DECISION_LABELS = { approve: 'Approve', decline: 'Decline' } as const

const TARGET_KIND_LABELS = { domain: 'Domain', person: 'Person' } as const

type StaffTab = 'queue' | 'decisions'

export function StaffRouteView() {
  const { data: me } = useCurrentUser()
  if (!me.isStaff) return <ShellNotFound />
  return <StaffAccessReview />
}

function StaffAccessReview() {
  const queue = useSuspenseQuery(staffQueueQueryOptions())
  const [tab, setTab] = useState<StaffTab>('queue')
  const decisions = useQuery({
    ...staffDecisionsQueryOptions(),
    enabled: tab === 'decisions',
  })
  const [decision, setDecision] = useState<StaffDecisionInput | null>(null)
  return (
    <PageScaffold
      title="Access review"
      description="Review requests for access to Obiter."
    >
      <SegmentedControl<StaffTab>
        label="Access review views"
        value={tab}
        options={[
          { value: 'queue', label: 'Waiting for review' },
          { value: 'decisions', label: 'Decisions' },
        ]}
        onChange={setTab}
      />
      {tab === 'queue' ? (
        <AccessQueue groups={queue.data.groups} onDecide={setDecision} />
      ) : decisions.isPending ? (
        <p className="text-meta text-muted">Loading decisions…</p>
      ) : decisions.isError ? (
        <ErrorNotice message="Could not load past decisions." />
      ) : (
        <DecisionsTable decisions={decisions.data.decisions} />
      )}
      {decision && (
        <DecisionDialog input={decision} onClose={() => setDecision(null)} />
      )}
    </PageScaffold>
  )
}

function DecisionsTable({ decisions }: { decisions: StaffDecision[] }) {
  if (!decisions.length)
    return <p className="text-meta text-muted">No decisions yet.</p>
  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[40rem]">
        <THead>
          <TR>
            <TH>Target</TH>
            <TH>Decision</TH>
            <TH>By</TH>
            <TH>When</TH>
          </TR>
        </THead>
        <TBody>
          {decisions.map((item) => (
            <TR key={item.id}>
              <TD className="break-words">
                {TARGET_KIND_LABELS[item.targetKind]}: {item.target}
              </TD>
              <TD>{DECISION_LABELS[item.decision]}</TD>
              <TD>{item.staffName}</TD>
              <TD className="text-muted">{formatDateTime(item.createdAt)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

function DecisionDialog({
  input,
  onClose,
}: {
  input: StaffDecisionInput
  onClose: () => void
}) {
  const needsOrganisations =
    input.target.kind === 'domain' && input.decision === 'approve'
  const organisations = useQuery({
    ...staffOrganisationsQueryOptions(),
    enabled: needsOrganisations,
  })
  const [organisationId, setOrganisationId] = useState('')
  const client = useQueryClient()
  const { toast } = useToast()
  const mutation = useMutation({
    mutationFn: async () =>
      staffDecisionResponseSchema.parse(
        await apiFetch('/api/staff/access/decisions', {
          method: 'POST',
          body: JSON.stringify({
            ...input,
            ...(organisationId ? { organisationId } : {}),
          }),
        }),
      ),
    onSuccess: async (data) => {
      await client.invalidateQueries({ queryKey: ['staff'] })
      toast({
        title:
          input.decision === 'approve' ? 'Access approved' : 'Access declined',
        description: `${data.count} request(s) updated.`,
      })
      onClose()
    },
  })
  const title =
    input.decision === 'approve' ? 'Confirm approval' : 'Confirm decline'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {input.target.kind === 'domain'
            ? `This decision applies to everyone waiting on ${input.target.domain}.`
            : 'This decision applies only to this person.'}{' '}
          They will receive an email.
        </DialogDescription>
        {needsOrganisations ? (
          organisations.isPending ? (
            <p className="text-meta text-muted">Loading organisations…</p>
          ) : organisations.isError ? (
            <ErrorNotice message="Could not load organisations." />
          ) : (
            <Select
              label="Existing organisation (optional)"
              options={[
                { value: '', label: 'No organisation link' },
                ...(organisations.data?.organisations ?? []).map((org) => ({
                  value: org.id,
                  label: org.name,
                })),
              ]}
              value={organisationId}
              onValueChange={(value) => setOrganisationId(value ?? '')}
            />
          )
        ) : null}
        {mutation.isError ? (
          <ErrorNotice message="The decision could not be saved. Try again." />
        ) : null}
        <DialogFooter>
          <DialogClose
            render={
              <Button variant="secondary" disabled={mutation.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            variant={input.decision === 'approve' ? 'primary' : 'danger'}
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
