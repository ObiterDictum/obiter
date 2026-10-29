import { readFileSync } from 'node:fs'

const testFile =
  (globalThis as { Bun?: { main?: string } }).Bun?.main ?? process.argv[1]

if (
  testFile === undefined ||
  (!testFile.endsWith('.test.ts') &&
    !testFile.endsWith('.test.tsx') &&
    !testFile.endsWith('.test.mjs'))
) {
  // Not a test file (should not happen under `bun test`); nothing to install.
} else {
  let source = ''
  try {
    source = readFileSync(testFile, 'utf8')
  } catch {
    source = ''
  }
  if (source.includes('@obiter/test-dom')) {
    await import('@obiter/test-dom')
  }
}
