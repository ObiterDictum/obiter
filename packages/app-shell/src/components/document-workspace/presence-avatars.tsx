import type { DocumentPresence } from '@obiter/contracts'
import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import {
  presenceLabel,
  presencePeople,
  visiblePresence,
  type PresencePerson,
} from './document-presence'

function ActivityWord({ person }: { person: PresencePerson }) {
  return person.activity === 'editing' ? <>editing</> : <>viewing</>
}

function Avatar({ person }: { person: PresencePerson }) {
  const label = `${person.name}, ${person.activity}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className={cn(
              'grid size-6 place-items-center rounded-pill border border-line bg-inset tracking-tight text-caption text-muted',
            )}
          >
            {person.initials}
          </span>
        }
      />
      <TooltipContent>
        {person.name} is <ActivityWord person={person} />
      </TooltipContent>
    </Tooltip>
  )
}

export function PresenceAvatars({
  presence,
  currentUserId,
  names,
}: {
  presence: readonly DocumentPresence[]
  currentUserId?: string
  names?: ReadonlyMap<string, string>
}) {
  const people = presencePeople(
    presence,
    currentUserId,
    names ?? new Map<string, string>(),
  )
  if (people.length === 0) return null
  const { shown, hiddenCount } = visiblePresence(people)

  return (
    <span aria-label={presenceLabel(people)} className="flex items-center pl-1">
      {shown.map((person) => (
        <Avatar key={person.userId} person={person} />
      ))}
      {hiddenCount > 0 ? (
        <span className="grid h-6 min-w-6 place-items-center rounded-pill border border-line bg-inset px-1 text-caption text-subtle">
          +{hiddenCount}
        </span>
      ) : null}
    </span>
  )
}
