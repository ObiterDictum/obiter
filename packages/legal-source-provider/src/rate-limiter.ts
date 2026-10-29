export const mojRequestWindowMs = 5 * 60 * 1000

export type MojRequestCharge =
  | { status: 'allowed' }
  | { status: 'rate_limited'; retryAfterSeconds: number }
  | { status: 'unavailable' }

export interface MojRequestBudget {
  charge(now?: number): Promise<MojRequestCharge>
}

export function createMojRateLimiter(limit: number) {
  const windowMs = mojRequestWindowMs
  const timestamps: number[] = []

  function take(now = Date.now()) {
    while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
      timestamps.shift()
    }

    if (timestamps.length >= limit) {
      const retryAfterSeconds = Math.ceil(
        (timestamps[0] + windowMs - now) / 1000,
      )
      return { allowed: false as const, retryAfterSeconds }
    }

    timestamps.push(now)
    return { allowed: true as const, retryAfterSeconds: 0 }
  }

  return {
    take,
    async charge(now = Date.now()): Promise<MojRequestCharge> {
      const taken = take(now)
      return taken.allowed
        ? { status: 'allowed' }
        : { status: 'rate_limited', retryAfterSeconds: taken.retryAfterSeconds }
    },
  }
}
