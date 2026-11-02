import { cn } from './lib/cn'

export const FORMER_MEMBER_MARKER = '(former member)'

export function formerMemberName(name: string, formerMember?: boolean) {
  return formerMember ? `${name} ${FORMER_MEMBER_MARKER}` : name
}

export function PersonName({
  name,
  formerMember,
  className,
}: {
  name: string
  formerMember?: boolean
  className?: string
}) {
  return (
    <span className={cn(className)}>
      {name}
      {formerMember ? (
        <span className="text-muted"> {FORMER_MEMBER_MARKER}</span>
      ) : null}
    </span>
  )
}
