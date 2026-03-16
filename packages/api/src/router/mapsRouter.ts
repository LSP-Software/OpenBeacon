import type { TRPCRouterRecord } from "@trpc/server";
import { env } from "../env.ts";
import { createSignedPmtilesUrl } from "../r2.ts";
import { protectedProcedure } from "../trpc.ts";

export type GetSignedPmtilesUrlResponse = {
  url: string;
  expiresAt: string;
};

export const mapsRouter = {
  getSignedPmtilesUrl: protectedProcedure.query(async ({ ctx }) => {
    const signedUrl = await createSignedPmtilesUrl();

    console.info(
      `[maps.getSignedPmtilesUrl] userId=${ctx.session.user.id} key=${env.R2_PM_TILES_KEY} expiresAt=${signedUrl.expiresAt}`,
    );

    return signedUrl satisfies GetSignedPmtilesUrlResponse;
  }),
} satisfies TRPCRouterRecord;
