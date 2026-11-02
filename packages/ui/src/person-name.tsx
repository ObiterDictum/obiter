export const FORMER_MEMBER_MARKER = '(former member)'

export type PersonSummary = { name: string; formerMember?: boolean }

export function formerMemberName(name: string, formerMember?: boolean) {
  return formerMember ? `${name} ${FORMER_MEMBER_MARKER}` : name
}

export function PersonName({
  person,
  className,
}: {
  person: PersonSummary
  className?: string
}) {
  return (
    <span className={className}>
      {person.name}
      {person.formerMember ? (
        <span className="text-muted"> {FORMER_MEMBER_MARKER}</span>
      ) : null}
    </span>
  )
}
