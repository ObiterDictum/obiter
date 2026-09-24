import { expect } from 'bun:test'

/**
 * The same assertion as vitest's `expect(promise).rejects.toSatisfy(predicate)`.
 *
 * bun:test has no working form of that chain: `.rejects.toSatisfy` hands the
 * predicate the rejected Promise instead of the rejection reason and returns
 * undefined, so it can never pass. Await the rejection here and apply the
 * predicate to the reason, failing the test outright if the promise resolves.
 */
export async function expectRejection(
  promise: Promise<unknown>,
  predicate: (error: unknown) => boolean | object,
): Promise<void> {
  const outcome = await promise.then(
    (value) => ({ resolved: true as const, value }),
    (error) => ({ resolved: false as const, error }),
  )
  if (outcome.resolved) {
    throw new Error(
      'expected the promise to reject, but it resolved with ' +
        `${typeof outcome.value}`,
    )
  }
  expect(predicate(outcome.error)).toBeTruthy()
}
