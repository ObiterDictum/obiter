import { useRef, useState } from 'react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery, queryOptions } from '@tanstack/react-query'
import { errorGroupListSchema } from '@obiter/contracts'
import { Skeleton } from '@obiter/ui'
import { apiFetch } from '../api'
import { validateStaffErrorsSearch } from '../staff-search'
import { PageScaffold } from '../page-scaffold'
import { SegmentedControl } from '../segmented-control'
import { formatDateTime, formatRelativeTime } from '../format'
import { StaffGate } from './staff-gate'
import { ErrorNotice } from './settings-fields'
import { ErrorDailyChart } from './staff-errors-chart'
import { ErrorDetail } from './staff-errors-detail'

export function staffErrorsQueryOptions(days = 30) {
  return queryOptions({
    queryKey: ['staff', 'errors', days],
    queryFn: async () =>
      errorGroupListSchema.parse(
        await apiFetch(`/api/staff/errors?days=${days}`),
      ),
  })
}
export function StaffErrorsRouteView() {
  const navigate = useNavigate()
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const days =
    validateStaffErrorsSearch(Object.fromEntries(new URLSearchParams(search)))
      .days ?? 30
  return (
    <StaffGate>
      <StaffErrors
        days={days}
        onDaysChange={(days) =>
          void navigate({ to: '/staff/errors', search: { days } })
        }
      />
    </StaffGate>
  )
}
export function StaffErrors({
  days = 30,
  onDaysChange,
}: {
  days?: number
  onDaysChange?: (days: number) => void
}) {
  const groups = useQuery(staffErrorsQueryOptions(days))
  const [selected, setSelected] = useState<string | null>(null)
  const selectedRow = useRef<HTMLTableRowElement | null>(null)
  const group = groups.data?.groups.find(
    (item) => item.fingerprint === selected,
  )
  function close() {
    setSelected(null)
    selectedRow.current?.focus()
  }
  return (
    <PageScaffold
      title="Errors"
      description={`Scrubbed errors from the last ${days} days, newest first.`}
      actions={
        <SegmentedControl<string>
          label="Days shown"
          value={String(days)}
          options={[7, 30, 90].map((days) => ({
            value: String(days),
            label: `${days} days`,
          }))}
          onChange={(value) => {
            setSelected(null)
            onDaysChange?.(Number(value))
          }}
        />
      }
    >
      {groups.isPending ? (
        <Skeleton className="h-28" />
      ) : groups.isError ? (
        <ErrorNotice message="Could not load errors." />
      ) : (
        <div className="@container flex flex-col gap-6">
          <ErrorDailyChart daily={groups.data.daily} />
          {groups.data.groups.length === 0 ? (
            <p className="text-meta text-muted">
              No errors in the last {days} days.
            </p>
          ) : (
            <div
              className={`grid min-w-0 items-start gap-6 ${group ? '@min-[1000px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]' : ''}`}
            >
              <div className="min-w-0 overflow-x-auto">
                <table
                  aria-label="Error groups"
                  className="w-full text-meta text-ink"
                >
                  <thead>
                    <tr>
                      {[
                        'Kind',
                        'Message',
                        'Source',
                        'Build',
                        'Count',
                        'Users',
                        'Last seen',
                      ].map((label) => (
                        <th
                          key={label}
                          scope="col"
                          className={`px-2 py-2 ${['Count', 'Users'].includes(label) ? 'text-right' : 'text-left'}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.data.groups.map((item) => (
                      <tr
                        key={item.fingerprint}
                        ref={
                          item.fingerprint === selected
                            ? selectedRow
                            : undefined
                        }
                        tabIndex={0}
                        aria-expanded={item.fingerprint === selected}
                        className="cursor-pointer hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => setSelected(item.fingerprint)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            setSelected(item.fingerprint)
                          }
                        }}
                      >
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-expanded={item.fingerprint === selected}
                          >
                            {item.kind}
                          </button>
                        </td>
                        <td
                          className="max-w-48 truncate px-2 py-2"
                          title={item.message}
                        >
                          {item.message}
                        </td>
                        <td className="px-2 py-2">
                          {item.source === 'api' ? 'API' : item.source}
                        </td>
                        <td
                          className="px-2 py-2 font-mono"
                          title={item.build ?? undefined}
                        >
                          {item.build?.slice(0, 7) ?? 'Unknown'}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {item.count}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {item.users}
                        </td>
                        <td
                          className="whitespace-nowrap px-2 py-2"
                          title={formatDateTime(item.lastSeen)}
                        >
                          {formatRelativeTime(item.lastSeen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {group ? (
                <ErrorDetail
                  key={group.fingerprint}
                  group={group}
                  onClose={close}
                />
              ) : null}
            </div>
          )}
        </div>
      )}
    </PageScaffold>
  )
}
