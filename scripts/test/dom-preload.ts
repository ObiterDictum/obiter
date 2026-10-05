import { readFileSync } from 'node:fs'

/**
 * Installs jsdom before the test file's own imports when that file asks for
 * it — a file is a DOM test if it imports '@obiter/test-dom'.
 *
 * bun does not hoist module mocks or run a setup file the way vitest's jsdom
 * environment did, and it evaluates bare specifiers before relative ones, so
 * a per-file setup import can run after React has already cached
 * `canUseDOM` and after Testing Library has bound `screen`. A preload runs
 * before any import of the test module, which is the only point early enough;
 * bun exposes the file being run as Bun.main (process.argv[1] as a fallback).
 *
 * Files that do not import the marker are untouched: node-environment suites
 * keep `typeof window === 'undefined'`.
 */
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
