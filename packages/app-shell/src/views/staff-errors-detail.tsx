import { useQuery } from '@tanstack/react-query'
import { errorGroupDetailSchema, type ErrorGroupList } from '@obiter/contracts'
import { Button, Skeleton } from '@obiter/ui'
import { apiFetch } from '../api'
import { formatDateTime } from '../format'
import { ErrorNotice } from './settings-fields'

export function ErrorDetail({
  group,
  onClose,
}: {
  group: ErrorGroupList['groups'][number]
  onClose: () => void
}) {
  const detail = useQuery({
    queryKey: ['staff', 'errors', 'detail', group.fingerprint],
    queryFn: async () =>
      errorGroupDetailSchema.parse(
        await apiFetch(`/api/staff/errors/${group.fingerprint}`),
      ),
  })
  const facts = [
    ['First seen', formatDateTime(group.firstSeen)],
    ['Last seen', formatDateTime(group.lastSeen)],
    ['Count', group.count],
    ['Users', group.users],
    ['Source', group.source === 'api' ? 'API' : group.source],
    ['Build', group.build?.slice(0, 7) ?? 'Unknown build'],
  ]
  return (
    <section
      aria-label="Error detail"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
      className="min-w-0 rounded-lg border border-border bg-raised p-4 focus-visible:outline-2 focus-visible:outline-ring @min-[1000px]:max-h-[460px] @min-[1000px]:overflow-y-auto"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-item text-ink">{group.kind}</h2>
          <p className="break-words text-meta text-muted">{group.message}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </header>
      <dl className="my-4 grid grid-cols-2 gap-3 text-caption">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="text-ink tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="text-item text-ink">Recent samples</h3>
      {detail.isPending ? (
        <Skeleton className="h-28" />
      ) : detail.isError ? (
        <ErrorNotice message="Could not load error detail." />
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {detail.data.samples.map((sample, index) => (
            <article
              key={index}
              className="min-w-0 rounded-md border border-border p-3 text-meta text-ink"
            >
              <time dateTime={sample.time}>{formatDateTime(sample.time)}</time>
              <p className="break-all text-muted">
                {sample.route} · {sample.build?.slice(0, 7) ?? 'Unknown build'}
                {sample.method ? ` · ${sample.method}` : ''}
                {sample.status ? ` · ${sample.status}` : ''}
              </p>
              <ol className="mt-3 space-y-2 font-mono text-caption">
                {sample.frames.map((frame, index) => (
                  <li key={index} className="break-all">
                    <span>{frame.function}</span>
                    <span className="block text-muted">
                      {frame.file}:{frame.line}:{frame.column}
                    </span>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
