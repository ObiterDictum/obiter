import { z } from 'zod'

export const errorFrameSchema = z.strictObject({
  function: z.string().max(300),
  file: z.string().max(200),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
})
export const errorReportSchema = z.strictObject({
  source: z.enum(['web', 'desktop', 'api']),
  build: z.string().regex(/^[a-f0-9]{7,40}$/).nullable(),
  kind: z.string().max(300),
  message: z.string().max(300),
  frames: z.array(errorFrameSchema).max(30),
  route: z.string().max(1000),
  method: z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']).optional(),
  status: z.number().int().min(100).max(599).optional(),
})
export const errorReportBatchSchema = z.strictObject({ reports: z.array(errorReportSchema).min(1).max(20) })
export const errorSampleSchema = errorReportSchema.extend({
  userId: z.string().nullable(), organisationId: z.string().nullable(),
  time: z.iso.datetime(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
export const errorGroupSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), kind: z.string(), message: z.string(),
  count: z.number().int().nonnegative(), users: z.number().int().nonnegative(),
  firstSeen: z.iso.datetime(), lastSeen: z.iso.datetime(),
  build: errorReportSchema.shape.build, source: errorReportSchema.shape.source,
})
export const errorDailySeriesSchema = z.array(z.strictObject({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().nonnegative() }))
export const errorGroupListSchema = z.strictObject({ groups: z.array(errorGroupSchema), daily: errorDailySeriesSchema })
export const errorGroupDetailSchema = z.strictObject({ samples: z.array(errorSampleSchema).max(20) })
export type ErrorReport = z.infer<typeof errorReportSchema>
export type ErrorGroupList = z.infer<typeof errorGroupListSchema>
