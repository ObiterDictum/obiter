export function createMojRateLimiter(limit: number) {
  const windowMs = 5 * 60 * 1000
  const timestamps: number[] = []

  return {
    take(now = Date.now()) {
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
    },
  }
}
