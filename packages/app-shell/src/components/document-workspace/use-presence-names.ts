import { useMemo } from 'react'
import { useCurrentUser } from '../../current-user'
import { useOrganisationMembers } from '../../organisation-membership'

export function usePresenceNames(): ReadonlyMap<string, string> {
  const { data: me } = useCurrentUser()
  const organisationId = me?.organisation?.id ?? ''
  const members = useOrganisationMembers(organisationId, {
    enabled: Boolean(organisationId),
  })
  const list = members.data
  return useMemo(() => {
    const names = new Map<string, string>()
    for (const member of list ?? []) names.set(member.id, member.name)
    return names
  }, [list])
}
