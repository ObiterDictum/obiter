import { Button } from '@obiter/ui'
import type { StaffDecisionInput, StaffQueueResponse } from '@obiter/contracts'
import { formatDate } from '../format'
import { CATEGORY_OPTIONS, COUNTRY_OPTIONS } from './request-access-form'

function optionLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  const found = options.find((option) => option.value === value)
  if (!found) throw new Error(`Unknown option value: ${value}`)
  return found.label
}

export function AccessQueue({
  groups,
  onDecide,
}: {
  groups: StaffQueueResponse['groups']
  onDecide: (input: StaffDecisionInput) => void
}) {
  if (!groups.length)
    return (
      <p className="text-meta text-muted">
        No requests are waiting for review.
      </p>
    )
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section
          key={group.domain}
          className="min-w-0 border-b border-line pb-6"
        >
          <h2 className="text-section break-words text-ink">{group.domain}</h2>
          <p className="text-body text-ink">
            {group.organisationNames.join(', ')}
          </p>
          <p className="text-body text-muted">
            {group.count} waiting · Oldest {formatDate(group.oldestCreatedAt)}
          </p>
          <p className="text-body text-muted">
            {group.categories
              .map((c) => optionLabel(CATEGORY_OPTIONS, c))
              .join(', ')}{' '}
            ·{' '}
            {group.countries
              .map((c) => optionLabel(COUNTRY_OPTIONS, c))
              .join(', ')}
          </p>
          {group.organisationNames.map((name) => (
            <RegisterLinks key={name} name={name} />
          ))}
          <div className="my-4 flex flex-wrap gap-2">
            <Button
              onClick={() =>
                onDecide({
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
                onDecide({
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
                <p className="break-words text-body text-ink">
                  {person.name} · {person.email}
                </p>
                <p className="text-body text-muted">
                  {optionLabel(CATEGORY_OPTIONS, person.category)} ·{' '}
                  {formatDate(person.createdAt)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      onDecide({
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
                      onDecide({
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
          className="text-body text-brand underline"
        >
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
    </div>
  )
}
