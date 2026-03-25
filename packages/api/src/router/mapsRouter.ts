import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import { protectedProcedure } from "../procedures/auth/base.ts";
import { createSignedPmtilesUrl } from "../r2.ts";

export const mapsRouter = {
  getSignedPmtilesUrl: protectedProcedure.query(async ({ ctx }) => {
    const signedUrl: {
      url: string;
      expiresAt: string;
    } = await createSignedPmtilesUrl();

    console.info(
      `[maps.getSignedPmtilesUrl] userId=${ctx.session.user.id} key=${env.R2_PM_TILES_KEY} expiresAt=${signedUrl.expiresAt}`,
    );

    return signedUrl;
  }),
} satisfies TRPCRouterRecord;
