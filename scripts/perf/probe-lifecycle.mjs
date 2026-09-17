/*
 * Ownership and bounded execution for the editor-interaction probes.
 *
 * `bounded()` races a probe against a timer because a sample against a large
 * document can stop making progress: a renderer that is still repaginating can
 * leave `page.keyboard.type` waiting far longer than any sample is allowed to
 * take. Winning that race is not enough on its own. The abandoned probe keeps
 * its page and browser context until its own inner timeouts fire, so the next
 * sample measures a browser that is busy with work the run already declared
 * failed. That is what happened to `after-typing-large`: samples 0 and 1
 * exceeded the 300 s bound, and samples 2 to 4 could not finish `page.goto`
 * within 30 s against the renderers they left behind.
 *
 * So a probe registers every resource it creates with an ownership ledger
 * before it starts, and every exit from the bound closes and awaits those
 * resources before the next sample is scheduled. The ledger owns only what the
 * probe hands it and closes only those resources, so it cannot touch a context
 * or process it did not create.
 */

/**
 * Raised when a sample's resources could not be confirmed closed. The caller
 * stops the campaign rather than measuring later samples under contention it
 * cannot account for.
 */
export class ProbeCleanupUnconfirmedError extends Error {
  constructor({ mode, index, cause }) {
    super(
      `${mode} sample ${index} left resources that could not be closed: ` +
        (cause?.message ?? 'no reason reported'),
    )
    this.name = 'ProbeCleanupUnconfirmedError'
  }
}

/** A ledger of the resources one sample owns. One per sample attempt. */
export function createProbeOwnership() {
  const owned = new Set()
  let abandoned = false
  return {
    /**
     * Create a resource and take ownership of it in one step. A resource
     * created after the sample was abandoned is closed immediately: the sample
     * is already a failure, so nothing it produces may outlive the bound.
     */
    async create(factory) {
      const resource = await factory()
      if (abandoned) {
        await resource.close()
        throw new Error('sample was abandoned before this resource was created')
      }
      owned.add(resource)
      return resource
    },
    /** Stop owning a resource that closed successfully. */
    release(resource) {
      owned.delete(resource)
    },
    /**
     * Close everything still owned, await it, and report whether the close was
     * confirmed. Idempotent, so a probe that closed its own resources and an
     * abandoned one are both handled. Returns rather than throws because the
     * caller decides whether an unconfirmed close can be measured at all.
     */
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

/**
 * Run one sample under an explicit bound. However the bound is left — the probe
 * settling or the timer firing first — every resource the probe still owns is
 * closed and awaited before this returns or throws, so the next sample cannot
 * start against a browser the previous one left busy. A probe that settles
 * after the bound is ignored; its result never reaches the caller.
 */
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

/**
 * Run the requested samples of one mode through `bounded`.
 *
 * A time-out is recorded as a failure and the campaign continues, because a
 * bound is evidence about one sample. A sample whose resources could not be
 * closed, or which `confirmIdle` reports left browser work open, ends the
 * campaign instead: later samples would be measuring that contention as if it
 * were product latency.
 */
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
