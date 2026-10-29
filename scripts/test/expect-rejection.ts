import { expect } from 'bun:test'

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
