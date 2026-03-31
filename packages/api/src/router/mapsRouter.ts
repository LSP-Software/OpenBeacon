import type { TRPCRouterRecord } from "@trpc/server";
import { protectedProcedure } from "../procedures/auth/runtime.ts";
import { createSignedPmtilesUrl } from "../r2.ts";

export const mapsRouter = {
  getSignedPmtilesUrl: protectedProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .query(async () => {
      const signedUrl: {
        url: string;
        expiresAt: string;
      } = await createSignedPmtilesUrl();

      console.info(`[maps.getSignedPmtilesUrl] expiresAt=${signedUrl.expiresAt}`);

      return signedUrl;
    }),
} satisfies TRPCRouterRecord;
