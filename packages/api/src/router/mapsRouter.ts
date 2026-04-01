import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import {
  forceRefreshSignedPmtilesUrlForUser,
  getSignedPmtilesUrlForUser,
} from "../lib/pmtilesUrl.ts";
import { protectedProcedure } from "../procedures/auth/runtime.ts";

export const mapsRouter = {
  getSignedPmtilesUrl: protectedProcedure
    .meta({
      rateLimit: {
        limit: 20,
        windowMs: 60_000,
      },
    })
    .query(async ({ ctx }) => {
      const signedUrl = await getSignedPmtilesUrlForUser({
        cache: ctx.cache,
        userId: ctx.session.user.id,
      });

      console.info(
        `[maps.getSignedPmtilesUrl] userId=${ctx.session.user.id} key=${env.R2_PM_TILES_KEY} expiresAt=${signedUrl.expiresAt} source=${signedUrl.source}`,
      );

      return {
        expiresAt: signedUrl.expiresAt,
        refreshAt: signedUrl.refreshAt,
        url: signedUrl.url,
      };
    }),
  forceRefreshSignedPmtilesUrl: protectedProcedure
    .meta({
      rateLimit: {
        limit: 3,
        windowMs: 600_000,
      },
    })
    .mutation(async ({ ctx }) => {
      const signedUrl = await forceRefreshSignedPmtilesUrlForUser({
        cache: ctx.cache,
        userId: ctx.session.user.id,
      });

      console.info(
        `[maps.forceRefreshSignedPmtilesUrl] userId=${ctx.session.user.id} key=${env.R2_PM_TILES_KEY} expiresAt=${signedUrl.expiresAt} source=${signedUrl.source}`,
      );

      return {
        expiresAt: signedUrl.expiresAt,
        refreshAt: signedUrl.refreshAt,
        url: signedUrl.url,
      };
    }),
} satisfies TRPCRouterRecord;
