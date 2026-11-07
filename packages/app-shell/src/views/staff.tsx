import { useState } from 'react'
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
  useToast,
} from '@obiter/ui'
import {
  staffDecisionResponseSchema,
  type StaffDecisionInput,
} from '@obiter/contracts'
import { apiFetch } from '../api'
import { PageScaffold } from '../page-scaffold'
import { useCurrentUser } from '../current-user'
import {
  staffQueueQueryOptions,
  staffDecisionsQueryOptions,
  staffOrganisationsQueryOptions,
} from '../staff'

export function StaffRouteView() {
  const { data: me } = useCurrentUser()
  if (!me.isStaff)
    return (
      <PageScaffold title="Page not found">
        <p>This page is not available.</p>
      </PageScaffold>
    )
  return <StaffAccessReview />
}

function StaffAccessReview() {
  const queue = useSuspenseQuery(staffQueueQueryOptions())
  const decisions = useSuspenseQuery(staffDecisionsQueryOptions())
  const [tab, setTab] = useState<'queue' | 'decisions'>('queue')
  const [decision, setDecision] = useState<StaffDecisionInput | null>(null)
  return (
    <PageScaffold
      title="Staff"
      description="Review requests for access to Obiter."
    >
      <nav aria-label="Staff sections">
        <a href="/staff/access" aria-current="page">
          Access review
        </a>
      </nav>
      <div className="flex gap-2" role="group" aria-label="Access review views">
        <Button
          variant="secondary"
          aria-pressed={tab === 'queue'}
          onClick={() => setTab('queue')}
        >
          Waiting for review
        </Button>
        <Button
          variant="secondary"
          aria-pressed={tab === 'decisions'}
          onClick={() => setTab('decisions')}
        >
          Decisions
        </Button>
      </div>
      {tab === 'queue' ? (
        <div className="flex flex-col gap-8">
          {!queue.data.groups.length && (
            <p>No requests are waiting for review.</p>
          )}
          {queue.data.groups.map((group) => (
            <section
              key={group.domain}
              className="min-w-0 border-b border-line pb-6"
            >
              <h2 className="text-section break-words">{group.domain}</h2>
              <p>{group.organisationNames.join(', ')}</p>
              <p className="text-body text-muted">
                {group.count} waiting · Oldest{' '}
                {new Date(group.oldestCreatedAt).toLocaleDateString('en-GB')}
              </p>
              <p className="text-body text-muted">
                {group.categories.join(', ').replaceAll('_', ' ')} ·{' '}
                {group.countries.join(', ').replaceAll('_', ' ')}
              </p>
              {group.organisationNames.map((name) => (
                <RegisterLinks key={name} name={name} />
              ))}
              <div className="my-4 flex flex-wrap gap-2">
                <Button
                  onClick={() =>
                    setDecision({
                      target: { kind: 'domain', domain: group.domain },
                      decision: 'approve',
                    })
                  }
                >
                  Approve organisation
                </Button>
                <Button
                  variant="secondary"
                  onClick={() =>
                    setDecision({
                      target: { kind: 'domain', domain: group.domain },
                      decision: 'decline',
                    })
                  }
                >
                  Decline
                </Button>
              </div>
              <ul className="flex flex-col gap-4">
                {group.requests.map((person) => (
                  <li key={person.id} className="min-w-0">
                    <p className="break-words">
                      {person.name} · {person.email}
                    </p>
                    <p className="text-body text-muted">
                      {person.category.replaceAll('_', ' ')} ·{' '}
                      {new Date(person.createdAt).toLocaleDateString('en-GB')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setDecision({
                            target: { kind: 'person', requestId: person.id },
                            decision: 'approve',
                          })
                        }
                      >
                        Approve only this person
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setDecision({
                            target: { kind: 'person', requestId: person.id },
                            decision: 'decline',
                          })
                        }
                      >
                        Decline
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {decisions.data.decisions.map((item) => (
            <li key={item.id} className="break-words">
              {item.targetKind}: {item.target} · {item.decision} ·{' '}
              {item.staffName} ·{' '}
              {new Date(item.createdAt).toLocaleString('en-GB')}
            </li>
          ))}
        </ul>
      )}
      {decision && (
        <DecisionDialog input={decision} onClose={() => setDecision(null)} />
      )}
    </PageScaffold>
  )
}

function RegisterLinks({ name }: { name: string }) {
  const links = [
    ['SRA', 'https://www.sra.org.uk/consumers/register/'],
    [
      'BSB',
      'https://www.barstandardsboard.org.uk/for-the-public/search-a-barristers-record/the-barristers-register.html',
    ],
    ['Law Society of Scotland', 'https://www.lawscot.org.uk/find-a-solicitor/'],
    ['Law Society of Northern Ireland', 'https://www.lawsoc-ni.org/solicitors'],
    [
      'Companies House',
      `https://find-and-update.company-information.service.gov.uk/search?q=${encodeURIComponent(name)}`,
    ],
  ]
  return (
    <div
      className="my-3 flex flex-wrap gap-x-4 gap-y-2"
      aria-label={`Registers for ${name}`}
    >
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-body underline"
        >
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
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
  const organisations = useSuspenseQuery(staffOrganisationsQueryOptions())
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
        {input.target.kind === 'domain' && input.decision === 'approve' && (
          <label className="flex flex-col gap-2">
            Existing organisation (optional)
            <select
              value={organisationId}
              onChange={(event) => setOrganisationId(event.target.value)}
              className="rounded border border-line bg-raised p-2"
            >
              <option value="">No organisation link</option>
              {organisations.data.organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mutation.isError && (
          <p role="alert">The decision could not be saved. Try again.</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <DialogClose
            render={
              <Button variant="secondary" disabled={mutation.isPending}>
                Cancel
              </Button>
            }
          />
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving decision…' : title}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
