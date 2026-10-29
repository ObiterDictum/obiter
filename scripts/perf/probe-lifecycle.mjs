export class ProbeCleanupUnconfirmedError extends Error {
  constructor({ mode, index, cause }) {
    super(
      `${mode} sample ${index} left resources that could not be closed: ` +
        (cause?.message ?? 'no reason reported'),
    )
    this.name = 'ProbeCleanupUnconfirmedError'
  }
}

export function createProbeOwnership() {
  const owned = new Set()
  let abandoned = false
  return {
    async create(factory) {
      const resource = await factory()
      if (abandoned) {
        await resource.close()
        throw new Error('sample was abandoned before this resource was created')
      }
      owned.add(resource)
      return resource
    },
    release(resource) {
      owned.delete(resource)
    },
    async abandon() {
      abandoned = true
      const resources = [...owned]
      owned.clear()
      const failures = []
      await Promise.all(
        resources.map(async (resource) => {
          try {
            await resource.close()
          } catch (error) {
            failures.push(error)
          }
        }),
      )
      return { closed: failures.length === 0, failures }
    },
    get size() {
      return owned.size
    },
  }
}

export async function bounded(run, { mode, index, timeoutMs, ownership }) {
  let timer
  let outcome
  try {
    outcome = {
      sample: await Promise.race([
        run,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `${mode} sample ${index} exceeded ${timeoutMs / 1000}s`,
                ),
              ),
            timeoutMs,
          )
        }),
      ]),
    }
  } catch (error) {
    outcome = { error }
  } finally {
    clearTimeout(timer)
  }
  const { closed, failures } = await ownership.abandon()
  if (!closed)
    throw new ProbeCleanupUnconfirmedError({ mode, index, cause: failures[0] })
  if (outcome.error) throw outcome.error
  return outcome.sample
}

export async function runSamples({
  mode,
  samples,
  timeoutMs,
  probe,
  confirmIdle,
  onProgress,
}) {
  const rows = []
  const failed = []
  let aborted = null
  for (let index = 0; index < samples; index += 1) {
    const ownership = createProbeOwnership()
    const run = probe(ownership)
    try {
      const sample = await bounded(run, { mode, index, timeoutMs, ownership })
      if (confirmIdle && !(await confirmIdle())) {
        failed.push({
          index,
          reason: `${mode} sample ${index} left browser work open`,
        })
        aborted = `${mode} sample ${index} left browser work open; stopping the campaign`
      } else {
        rows.push({ index, ...sample })
      }
    } catch (error) {
      failed.push({ index, reason: error.message })
      if (error instanceof ProbeCleanupUnconfirmedError) aborted = error.message
    }
    onProgress?.(index)
    if (aborted) break
  }
  return { rows, failed, aborted }
}
