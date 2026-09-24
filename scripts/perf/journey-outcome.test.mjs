/*
 * Tests for the journey outcome rules the load runner gates samples on. A
 * wrong landing must fail the journey, and a declared redirect must not.
 */
import { expect, test } from 'bun:test'
import {
  clientNavProblem,
  evaluateJourney,
  expectedFinalPaths,
  journeyNeedsAuth,
  requiredFixtureKeys,
} from './journey-outcome.mjs'

const home = { id: 'home', path: '/' }
const caseLaw = {
  id: 'case-law-document',
  path: '/cases/{caseDocumentId}',
  redirectsTo: [/^\/case\/[^/]+$/],
}

test('requiredFixtureKeys lists the placeholders a path needs', () => {
  expect(requiredFixtureKeys(caseLaw)).toEqual(['caseDocumentId'])
  expect(requiredFixtureKeys(home)).toEqual([])
  expect(
    requiredFixtureKeys({ path: '/matters/{matterId}/documents/{documentId}' }),
  ).toEqual(['matterId', 'documentId'])
})

test('a client-navigation sample refuses a journey it would mislabel', () => {
  // Without an originating route the runner falls back to page.goto, which is a
  // hard navigation reported under the client-navigation label.
  expect(clientNavProblem(home, 'client')).toMatch(/clientNavFrom/)
  expect(
    clientNavProblem({ path: '/x', clientNavFrom: '/y' }, 'client'),
  ).toMatch(/clientNavName/)
  expect(
    clientNavProblem(
      { path: '/x', clientNavFrom: '/y', clientNavName: 'Z' },
      'client',
    ),
  ).toBeNull()
  // A hard-navigation run is unaffected.
  expect(clientNavProblem(home, 'hard')).toBeNull()
})

test('journeyNeedsAuth is false only for public journeys', () => {
  expect(journeyNeedsAuth(home)).toBe(true)
  expect(journeyNeedsAuth({ path: '/sign-in', public: true })).toBe(false)
})

test('exact final path passes', () => {
  expect(
    evaluateJourney({
      journey: home,
      targetPath: '/',
      finalPath: '/',
      ready: true,
    }),
  ).toEqual({ ok: true })
})

test('a bounce to sign-in fails the journey', () => {
  const outcome = evaluateJourney({
    journey: home,
    targetPath: '/',
    finalPath: '/sign-in',
    ready: true,
  })
  expect(outcome.ok).toBe(false)
  expect(outcome.reason).toMatch(/landed on \/sign-in, expected \//)
})

test('an access-denied or error route fails the journey', () => {
  const outcome = evaluateJourney({
    journey: home,
    targetPath: '/',
    finalPath: '/workspace',
    ready: true,
  })
  expect(outcome.ok).toBe(false)
  expect(outcome.reason).toMatch(/expected \//)
})

test('a declared canonical redirect passes', () => {
  expect(
    evaluateJourney({
      journey: caseLaw,
      targetPath: '/cases/doc-1',
      finalPath: '/case/uksc-2024-1',
      ready: true,
    }),
  ).toEqual({ ok: true })
})

test('a case journey that lands on the id route also passes', () => {
  expect(
    evaluateJourney({
      journey: caseLaw,
      targetPath: '/cases/doc-1',
      finalPath: '/cases/doc-1',
      ready: true,
    }),
  ).toEqual({ ok: true })
})

test('the wrong document fails the journey', () => {
  const outcome = evaluateJourney({
    journey: caseLaw,
    targetPath: '/cases/doc-1',
    finalPath: '/cases/doc-2',
    ready: true,
  })
  expect(outcome.ok).toBe(false)
})

test('a navigation timeout fails the journey', () => {
  const outcome = evaluateJourney({
    journey: home,
    targetPath: '/',
    finalPath: '/',
    ready: false,
    error: 'page.goto: Timeout 45000ms exceeded',
  })
  expect(outcome.ok).toBe(false)
  expect(outcome.reason).toMatch(/navigation failed/)
})

test('a missing route-ready control fails the journey', () => {
  const outcome = evaluateJourney({
    journey: home,
    targetPath: '/',
    finalPath: '/',
    ready: false,
  })
  expect(outcome.ok).toBe(false)
  expect(outcome.reason).toMatch(/route-ready control/)
})

test('expectedFinalPaths keeps the target first', () => {
  expect(expectedFinalPaths(home, '/')).toEqual(['/'])
  expect(expectedFinalPaths(caseLaw, '/cases/doc-1')).toHaveLength(2)
})
