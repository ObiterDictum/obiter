import { useState } from 'react'
import { useQuery, queryOptions } from '@tanstack/react-query'
import { errorGroupListSchema, errorGroupDetailSchema } from '@obiter/contracts'
import { Button, Skeleton } from '@obiter/ui'
import { apiFetch } from '../api'
import { PageScaffold } from '../page-scaffold'
import { formatDateTime } from '../format'
import { StaffGate } from './staff-gate'
import { ErrorNotice } from './settings-fields'
import { LineChart } from './staff-line-chart'

export function staffErrorsQueryOptions() {
  return queryOptions({queryKey:['staff','errors'],queryFn:async () => errorGroupListSchema.parse(await apiFetch('/api/staff/errors?days=30'))})
}
export function StaffErrorsRouteView() {return <StaffGate><StaffErrors /></StaffGate>}
export function StaffErrors() {
  const groups = useQuery(staffErrorsQueryOptions())
  const [selected,setSelected] = useState<string | null>(null)
  const detail = useQuery({queryKey:['staff','errors',selected],enabled:selected !== null,queryFn:async () => errorGroupDetailSchema.parse(await apiFetch(`/api/staff/errors/${selected}`))})
  return <PageScaffold title="Errors" description="Scrubbed errors from the last 30 days, newest first.">
    {groups.isPending ? <Skeleton className="h-28" /> : groups.isError ? <ErrorNotice message="Could not load errors." /> : <>
      <LineChart categories={groups.data.daily.map(day => day.day)} series={[{key:'errors',label:'Errors',colour:'var(--obiter-chart-1)',values:groups.data.daily.map(day => day.count)}]} ariaLabel="Daily error count" />
      {groups.data.groups.length === 0 ? <p className="text-meta text-muted">No errors to show.</p> : <table className="w-full text-meta text-ink"><thead><tr>{['Kind','Message','Count','Users','Last seen'].map(label => <th key={label} className="text-left">{label}</th>)}</tr></thead><tbody>{groups.data.groups.map(group => <tr key={group.fingerprint}><td><Button variant="ghost" onClick={() => setSelected(group.fingerprint)}>{group.kind}</Button></td><td>{group.message}</td><td>{group.count}</td><td>{group.users}</td><td>{formatDateTime(group.lastSeen)}</td></tr>)}</tbody></table>}
    </>}
    {selected ? <section aria-label="Error detail"><h2 className="text-item text-ink">Recent samples</h2>{detail.isPending ? <Skeleton className="h-28" /> : detail.isError ? <ErrorNotice message="Could not load error detail." /> : detail.data.samples.map((sample,index) => <div key={index} className="py-3 text-meta text-ink"><p>{sample.kind}: {sample.message}</p><p>{sample.source} · {sample.build ?? 'Unknown build'} · {sample.route} · {formatDateTime(sample.time)}</p><ol>{sample.frames.map((frame,i) => <li key={i}>{frame.function} ({frame.file}:{frame.line}:{frame.column})</li>)}</ol></div>)}</section> : null}
  </PageScaffold>
}
