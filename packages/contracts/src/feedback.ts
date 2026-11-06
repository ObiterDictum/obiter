import { z } from 'zod'

export const feedbackRequestSchema = z
  .object({
    kind: z.enum(['problem', 'idea', 'question']),
    message: z.string().trim().min(1).max(4000),
    path: z
      .string()
      .max(1024)
      .startsWith('/')
      .transform((path) => path.split(/[?#]/u)[0])
      .optional(),
    appVersion: z.string().min(1).max(128).optional(),
    platform: z.string().min(1).max(128).optional(),
  })
  .strict()
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>
