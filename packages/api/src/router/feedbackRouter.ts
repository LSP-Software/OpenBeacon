import { submitFeedbackSchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import type { TRPCRouterRecord } from "@trpc/server";
import { publicProcedure } from "../procedures/auth/runtime.ts";

export const feedbackRouter = {
  submit: publicProcedure
    .meta({ rateLimit: { limit: 3, windowMs: 600_000 } })
    .input(submitFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.selfHosted) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db.feedback.create({
        data: {
          message: input.message,
          email: input.email ?? null,
          androidVersion: input.androidVersion ?? null,
          appVersion: input.appVersion ?? null,
          maplibreVersion: input.maplibreVersion ?? null,
          serverVersion: input.serverVersion ?? null,
        },
      });
    }),
} satisfies TRPCRouterRecord;
