import { describe, expect, it } from 'vitest'
import type { UserRole } from '@obiter/contracts'
import { canGrantRole } from './authz'

const ROLES: UserRole[] = ['member', 'admin', 'owner']
const GRANTABLE: Record<UserRole, UserRole[]> = {
  member: ['member'],
  admin: ['member', 'admin'],
  owner: ['member', 'admin', 'owner'],
}

describe('canGrantRole', () => {
  it('bounds every actor/granted pair at the actor own role', () => {
    for (const actor of ROLES) {
      for (const granted of ROLES) {
        expect(canGrantRole(actor, granted)).toBe(
          GRANTABLE[actor].includes(granted),
        )
      }
    }
  })

  it('lets an owner grant owner and stops an admin doing so', () => {
    expect(canGrantRole('owner', 'owner')).toBe(true)
    expect(canGrantRole('admin', 'owner')).toBe(false)
  })
})
