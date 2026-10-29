import { z } from 'zod';
import { TIERS } from '@/lib/auth/auth-context';

/** Matches the cap the Edge Function enforces, so the browser fails first. */
const MAX_BATCH = 100;

/**
 * The reviewer's decision, validated in the browser.
 *
 * The identical rules are enforced again inside the Edge Function and a third
 * time in the database function. This copy exists purely so a reviewer sees the
 * problem before a request leaves the machine; it is not what makes the rule
 * true.
 */
export const reviewSchema = z
  .object({
    applicationIds: z
      .array(z.uuid())
      .min(1, 'Select at least one application')
      .max(MAX_BATCH, `No more than ${MAX_BATCH} at a time`),
    decision: z.enum(['approved', 'rejected']),
    tier: z.enum(TIERS).nullable(),
    note: z
      .string()
      .trim()
      .max(1000, 'Keep the note under 1000 characters')
      .nullable(),
  })
  .refine((v) => v.decision !== 'approved' || Boolean(v.tier), {
    message: 'Choose a tier before approving',
    path: ['tier'],
  })
  .refine((v) => v.decision !== 'rejected' || !v.tier, {
    message: 'A tier cannot be set when rejecting',
    path: ['tier'],
  });

export type ReviewInput = z.infer<typeof reviewSchema>;
