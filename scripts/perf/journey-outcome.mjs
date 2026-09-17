/*
 * Journey outcome decisions for the page-load runner.
 *
 * Kept apart from the browser plumbing so the rules that decide whether a sample
 * is a measurement of the target journey are unit-testable. A journey that lands
 * on sign-in, an access-denied page, a different document, or that never reaches
 * its route-ready control is a failure, not a fast result under the target's name.
 *
 * `redirectsTo` patterns are the legitimate redirects a journey may end on (the
 * `/cases/$caseId` route resolves an id to its canonical `/case/$caseSlug`).
 */

/** Fixture placeholders a journey path requires, in order. */
export function requiredFixtureKeys(journey) {
  return [...journey.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
}

/** A journey that is not explicitly public needs an authenticated session. */
export function journeyNeedsAuth(journey) {
  return journey.public !== true
}

/**
 * Why a client-navigation sample cannot be taken for this journey, or null.
 * Without the originating route and the control to click, the runner falls back
 * to `page.goto` — measuring a hard navigation and reporting it under the
 * client-navigation label. Refuse instead.
 */
export function clientNavProblem(journey, navMode) {
  if (navMode !== 'client') return null
  if (!journey.clientNavFrom)
    return 'no clientNavFrom: --nav client would measure a hard navigation'
  if (!journey.clientNavName) return 'no clientNavName: the link to click'
  return null
}

function matchesExpected(expected, actualPath) {
  return expected instanceof RegExp
    ? expected.test(actualPath)
    : expected === actualPath
}

/**
 * Paths a journey may legitimately end on: the one it asked for, plus any
 * declared redirect target.
 */
export function expectedFinalPaths(journey, targetPath) {
  return [targetPath, ...(journey.redirectsTo ?? [])]
}

/**
 * Decide whether a sample measured the target journey. `reason` names what was
 * seen, so a failure cannot be mistaken for a slow result. `error` is the
 * navigation/timeout error, if any; `ready` is whether the route-ready control
 * appeared before the timeout.
 */
export function evaluateJourney({
  journey,
  targetPath,
  finalPath,
  ready,
  error,
}) {
  if (error) return { ok: false, reason: `navigation failed: ${error}` }
  if (!ready) return { ok: false, reason: 'route-ready control did not appear' }
  const expected = expectedFinalPaths(journey, targetPath)
  if (!expected.some((path) => matchesExpected(path, finalPath)))
    return {
      ok: false,
      reason: `landed on ${finalPath}, expected ${targetPath}`,
    }
  return { ok: true }
}
