export function requiredFixtureKeys(journey) {
  return [...journey.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1])
}

export function journeyNeedsAuth(journey) {
  return journey.public !== true
}

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

export function expectedFinalPaths(journey, targetPath) {
  return [targetPath, ...(journey.redirectsTo ?? [])]
}

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
