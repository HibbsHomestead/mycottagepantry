import { z } from 'zod'

export const registrationPolicySchema = z
  .object({
    revision: z.string().trim().min(1).max(100),
    terms: z.string().trim().min(1).max(100000),
    privacy: z.string().trim().min(1).max(100000),
  })
  .strict()
export type RegistrationPolicy = z.infer<typeof registrationPolicySchema>
