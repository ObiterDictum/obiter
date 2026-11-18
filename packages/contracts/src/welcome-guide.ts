import { z } from 'zod'

export const welcomeGuideStateSchema = z
  .object({
    seenAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
export type WelcomeGuideState = z.infer<typeof welcomeGuideStateSchema>
