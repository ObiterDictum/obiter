import { describe, expect, it } from 'bun:test'
import { composeMojRequestBudget } from './moj-request-budget'
import type {
  MojRequestBudget,
  MojRequestCharge,
} from '@obiter/legal-source-provider'

function budget(...charges: MojRequestCharge[]) {
  let spent = 0
  const value: MojRequestBudget = {
    async charge() {
      const decided = charges[spent] ?? { status: 'allowed' }
      spent += 1
      return decided
    },
  }
  return { value, spent: () => spent }
}

describe('composeMojRequestBudget', () => {
  it('is the process limiter alone when no shared budget is configured', async () => {
    const local = budget({ status: 'rate_limited', retryAfterSeconds: 9 })
    const composed = composeMojRequestBudget(undefined, local.value)
    expect(await composed.charge()).toEqual({
      status: 'rate_limited',
      retryAfterSeconds: 9,
    })
  })

  it('does not spend a shared slot when the process backstop refuses first', async () => {
    const shared = budget({ status: 'allowed' })
    const local = budget({ status: 'rate_limited', retryAfterSeconds: 3 })
    const composed = composeMojRequestBudget(shared.value, local.value)

    expect(await composed.charge()).toEqual({
      status: 'rate_limited',
      retryAfterSeconds: 3,
    })
    // The shared ledger was never consulted, so no cluster slot was spent on
    // an attempt this replica refused.
    expect(shared.spent()).toBe(0)
  })

  it('charges the shared budget last, immediately before dispatch', async () => {
    const shared = budget({ status: 'unavailable' })
    const local = budget({ status: 'allowed' })
    const composed = composeMojRequestBudget(shared.value, local.value)

    expect(await composed.charge()).toEqual({ status: 'unavailable' })
    expect(shared.spent()).toBe(1)
  })

  it('passes a shared allowance through and surfaces a shared refusal', async () => {
    const shared = budget(
      { status: 'allowed' },
      { status: 'rate_limited', retryAfterSeconds: 4 },
    )
    const local = budget({ status: 'allowed' }, { status: 'allowed' })
    const composed = composeMojRequestBudget(shared.value, local.value)

    expect(await composed.charge()).toEqual({ status: 'allowed' })
    expect(await composed.charge()).toEqual({
      status: 'rate_limited',
      retryAfterSeconds: 4,
    })
  })
})
