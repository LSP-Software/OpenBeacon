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
          mapVersion: input.mapVersion ?? null,
          serverVersion: input.serverVersion ?? null,
        },
        select: { id: true },
      });
      const webhookUrl = ctx.feedbackWebhookUrl;
      if (!webhookUrl) return;

      void (async () => {
        const alert = await tryCatch(
          fetch(webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              content: `New feedback \`${feedback.id}\` (${input.email ? "contact email included" : "no contact email"})`,
              allowed_mentions: { parse: [] },
            }),
            redirect: "error",
            signal: AbortSignal.timeout(5_000),
          }),
        );
        if (!alert.data?.ok) {
          console.error("[feedback] Discord feedback webhook failed", {
            feedbackId: feedback.id,
            status: alert.data?.status ?? null,
            error: alert.error instanceof Error ? alert.error.name : null,
          });
          return;
        }
        console.log("[feedback] Discord feedback webhook called", { feedbackId: feedback.id });
      })();
    }),
} satisfies TRPCRouterRecord;
