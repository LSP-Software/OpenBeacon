import { submitFeedbackSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type { TRPCRouterRecord } from "@trpc/server";
import { publicProcedure } from "../procedures/auth/runtime.ts";

export const feedbackRouter = {
  submit: publicProcedure
    .meta({ rateLimit: { limit: 3, ipLimit: 3, windowMs: 600_000 } })
    .input(submitFeedbackSchema)
    .mutation(async ({ ctx, input }) => {
      if (ctx.selfHosted) throw new TRPCError({ code: "NOT_FOUND" });
      const feedback = await ctx.db.feedback.create({
        data: {
          message: input.message,
          email: input.email ?? null,
          androidVersion: input.androidVersion ?? null,
          appVersion: input.appVersion ?? null,
          maplibreVersion: input.maplibreVersion ?? null,
          serverVersion: input.serverVersion ?? null,
        },
        select: { id: true },
      });
      if (!ctx.feedbackWebhookUrl) return;

      const alert = await tryCatch(
        fetch(ctx.feedbackWebhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: `New feedback \`${feedback.id}\` (${input.email ? "contact email included" : "no contact email"})`,
            allowed_mentions: { parse: [] },
          }),
          signal: AbortSignal.timeout(5_000),
        }),
      );
      if (alert.error || !alert.data.ok) {
        console.error("[feedback] Discord alert failed", {
          status: alert.data?.status ?? null,
        });
      }
    }),
} satisfies TRPCRouterRecord;
