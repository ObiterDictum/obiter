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
      <Link to="/agent" className={rowClass(pathname === '/agent')}>
        New conversation
      </Link>
      {sessions.isPending ? (
        <p className="px-2 text-meta text-muted">Loading conversations…</p>
      ) : null}
      {sessions.error ? (
        <p role="alert" className="px-2 text-meta text-danger">
          {sessions.error.message}
        </p>
      ) : null}
      {sessions.data?.map((session) => (
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
    </nav>
  )
}
