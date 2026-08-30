let activeInflateCount = 0

export function getActiveInflateCount() {
  return activeInflateCount
}

export async function mapWithConcurrency<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  work: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  if (items.length === 0) return []
  const limit = Math.max(1, concurrency)
  const results = Array.from({ length: items.length }) as Result[]
  let nextIndex = 0

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      activeInflateCount += 1
      try {
        results[index] = await work(items[index]!, index)
      } finally {
        activeInflateCount -= 1
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  )
  return results
}
