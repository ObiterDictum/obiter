import { expect, it } from 'bun:test'
import { redactionDetectionProgressSchema } from './index'

it('accepts zero sections during extraction and completed section counts during detection', () => {
  expect(
    redactionDetectionProgressSchema.parse({ completed: 0, total: 0 }),
  ).toEqual({ completed: 0, total: 0 })
  expect(
    redactionDetectionProgressSchema.parse({ completed: 12, total: 40 }),
  ).toEqual({ completed: 12, total: 40 })
})

it('rejects impossible section progress rather than displaying a misleading count', () => {
  for (const progress of [
    { completed: -1, total: 4 },
    { completed: 2, total: 1 },
    { completed: 0.5, total: 4 },
  ]) {
    expect(redactionDetectionProgressSchema.safeParse(progress).success).toBe(
      false,
    )
  }
})
