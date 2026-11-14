import { z } from 'zod'

export const secureHttpsUrlSchema = z.string().superRefine((value, context) => {
  if (/\p{Cc}/u.test(value)) {
    context.addIssue({
      code: 'custom',
      message: 'URL must not contain control characters.',
    })
    return
  }
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== ''
    ) {
      context.addIssue({
        code: 'custom',
        message: 'URL must use HTTPS without embedded credentials.',
      })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'URL must be valid.' })
  }
})
