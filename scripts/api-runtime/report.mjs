/*
 * Result collection for the runtime harness.
 *
 * A check either passes or fails and carries the observed detail that justified
 * it, so a failing run explains itself from its own output rather than needing a
 * reproduction.
 */
export function createRecorder() {
  const results = []
  let group = 'general'
  return {
    group(name) {
      group = name
    },
    record(name, ok, detail, observed) {
      results.push({ group, name, ok: Boolean(ok), detail, observed })
    },
    results,
  }
}

export function printReport(results) {
  for (const result of results) {
    console.log(`\n=== ${result.runtime} (${result.checks.length} checks) ===`)
    let group = null
    for (const check of result.checks) {
      if (check.group !== group) {
        group = check.group
        console.log(`\n  ${group}`)
      }
      console.log(
        `    ${check.ok ? 'PASS' : 'FAIL'}  ${check.name} — ${check.detail}`,
      )
    }
  }
}
