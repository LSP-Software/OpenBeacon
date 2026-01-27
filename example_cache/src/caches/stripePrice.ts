import type { VARIANTS } from 'envs';
import type Redis from 'ioredis';
import type Stripe from 'stripe';
import { type CachedStripePricing, CachedStripePricingSchema } from '../types/stripePrice';

export class StripePriceCache {
  private key: string;
  private redis: Redis;
  private ttl = 60 * 60; // 1 hour

  constructor(redis: Redis, variant: VARIANTS) {
    this.key = `${variant}:stripe:prices`;
    this.redis = redis;
  }

  async get(stripe: Stripe, variantEnv: string): Promise<CachedStripePricing | null> {
    try {
      const cached = await this.redis.get(this.key);
      if (cached) {
        try {
          return CachedStripePricingSchema.parse(JSON.parse(cached));
        } catch (parseError) {
          console.error(`Failed to parse cached stripe prices for ${this.key}, refetching from the API.`, parseError);
        }
      }

      console.log(`Fetching pricing data from Stripe API for variant: ${variantEnv}`);

      const allPricingTiers = await stripe.prices.list({
        active: true,
        expand: ['data.tiers'],
        limit: 100,
      });

      let hasMore = allPricingTiers.has_more;
      let startingAfter = allPricingTiers.data[allPricingTiers.data.length - 1]?.id;

      while (hasMore && startingAfter) {
        const nextPage = await stripe.prices.list({
          active: true,
          expand: ['data.tiers'],
          limit: 100,
          starting_after: startingAfter,
        });

        allPricingTiers.data.push(...nextPage.data);
        hasMore = nextPage.has_more;
        startingAfter = nextPage.data[nextPage.data.length - 1]?.id;
      }

      console.log(`Found ${allPricingTiers.data.length} pricing tiers from Stripe`);

      const findPriceByInterval = (tier: string, interval: 'month' | 'year', intervalCount?: number) => {
        const found = allPricingTiers.data.find(
          (price) =>
            price.metadata.tier === tier &&
            price.metadata.variant === variantEnv &&
            price.recurring?.interval === interval &&
            (intervalCount ? price.recurring?.interval_count === intervalCount : true),
        );

        if (!found) {
          console.warn(
            `No price found for tier: ${tier}, interval: ${interval}, intervalCount: ${intervalCount}, variant: ${variantEnv}`,
          );
        }

        return found;
      };

      const getPeriodsForTier = (tier: string) => {
        const MONTHLY = findPriceByInterval(tier, 'month', 1);
        const QUARTERLY = findPriceByInterval(tier, 'month', 3);
        const YEARLY = findPriceByInterval(tier, 'year');

        if (!MONTHLY?.tiers || !QUARTERLY?.tiers || !YEARLY?.tiers) {
          const missing = [];
          if (!MONTHLY?.tiers) missing.push('MONTHLY');
          if (!QUARTERLY?.tiers) missing.push('QUARTERLY');
          if (!YEARLY?.tiers) missing.push('YEARLY');
          throw new Error(`Missing pricing tiers for ${tier}: ${missing.join(', ')}`);
        }

        return {
          MONTHLY: { priceId: MONTHLY.id, tiers: MONTHLY.tiers },
          QUARTERLY: { priceId: QUARTERLY.id, tiers: QUARTERLY.tiers },
          YEARLY: { priceId: YEARLY.id, tiers: YEARLY.tiers },
        };
      };

      const pricingTiers: CachedStripePricing = {
        PREMIUM: getPeriodsForTier('PREMIUM'),
        CUSTOM: getPeriodsForTier('CUSTOM'),
      };

      await this.set(pricingTiers);
      console.log(`Successfully cached pricing data for variant: ${variantEnv}`);
      return pricingTiers;
    } catch (error) {
      console.error(`Failed to get pricing data for variant ${variantEnv}:`, error);
      throw error;
    }
  }

  async set(pricing: CachedStripePricing) {
    try {
      CachedStripePricingSchema.parse(pricing);
      await this.redis.set(this.key, JSON.stringify(pricing), 'EX', this.ttl);
      console.log(`Successfully cached pricing data with key: ${this.key}`);
    } catch (error) {
      console.error(`Failed to cache pricing data with key ${this.key}:`, error);
      throw error;
    }
  }
}
