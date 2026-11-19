import { z } from 'zod'
import { documentModelWireSchema } from './document-model'

const wordReviewRangeSchema = z
  .object({
    storyPartName: z.string().min(1),
    paragraphId: z.string().min(1),
    runId: z.string().min(1),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  })
  .refine(({ from, to }) => from < to)

export const redactionWordLayoutSchema = z.object({
  model: documentModelWireSchema,
  spans: z.array(
    z.object({
      spanId: z.string().min(1),
      complete: z.boolean(),
      ranges: z.array(wordReviewRangeSchema),
    }),
  ),
})

export type RedactionWordLayout = z.infer<typeof redactionWordLayoutSchema>
