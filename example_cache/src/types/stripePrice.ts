import { SubscriptionPeriod } from 'database';
import { z } from 'zod';

export const PricingTierSchema = z.enum(['PREMIUM', 'CUSTOM']);

export const StripeTierSchema = z.object({
  flat_amount: z.number().nullable(),
  flat_amount_decimal: z.string().nullable(),
  unit_amount: z.number().nullable(),
  unit_amount_decimal: z.string().nullable(),
  up_to: z.number().nullable(),
});

export const CachedStripePricingSchema = z.record(
  PricingTierSchema,
  z.record(z.enum(SubscriptionPeriod), z.object({ priceId: z.string(), tiers: z.array(StripeTierSchema) })),
);

export type CachedStripePricing = z.infer<typeof CachedStripePricingSchema>;
export type PricingTier = z.infer<typeof PricingTierSchema>;
export type StripeTier = z.infer<typeof StripeTierSchema>;
