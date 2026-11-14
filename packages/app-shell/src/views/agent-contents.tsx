import { Plus } from '@obiter/ui/icons'
import { Link } from '@tanstack/react-router'
import { useSessions } from '../agent-sessions'
import { rowClass } from '../contents-sections'

function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(value)) / 60000),
  )
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
export function AgentContents({ pathname }: { pathname: string }) {
  const sessions = useSessions(null)
  return (
    <nav aria-label="Conversations" className="flex flex-col gap-1">
      <Link
        to="/agent"
        className="mb-4 flex items-center justify-center gap-2 rounded-md border border-line bg-raised px-3 py-2 text-meta text-ink hover:bg-hover"
      >
        <Plus size={14} aria-hidden /> New conversation
      </Link>
      {sessions.isPending ? (
        <p className="px-2 text-meta text-muted">Loading conversations…</p>
      ) : null}
      {sessions.error ? (
        <p role="alert" className="px-2 text-meta text-danger">
          {sessions.error.message}
        </p>
      ) : null}
      {['Today', 'Previous 7 days', 'Older'].map((group) => {
        const today = new Date(Date.now())
        today.setHours(0, 0, 0, 0)
        const rows =
          sessions.data?.filter((session) => {
            const age = today.getTime() - Date.parse(session.updatedAt)
            return (
              (age <= 0
                ? 'Today'
                : age < 7 * 86400000
                  ? 'Previous 7 days'
                  : 'Older') === group
            )
          }) ?? []
        return rows.length ? (
          <section key={group} className="mb-3">
            <h2 className="px-2 py-2 text-caption text-muted">{group}</h2>
            {rows.map((session) => (
              <Link
                key={session.id}
                to="/agent/$sessionId"
                params={{ sessionId: session.id }}
                aria-current={
                  pathname === `/agent/${session.id}` ? 'page' : undefined
                }
                className={rowClass(pathname === `/agent/${session.id}`)}
              >
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <time
                  dateTime={session.updatedAt}
                  className="shrink-0 text-caption text-subtle"
                >
                  {relativeTime(session.updatedAt)}
                </time>
              </Link>
            ))}
          </section>
        ) : null
      })}
    </nav>
  )
}
