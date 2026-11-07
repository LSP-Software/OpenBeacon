import { TRPCError } from "@trpc/server";
import type { TRPCRouterRecord } from "@trpc/server";
import { z } from "zod";
import { publicProcedure } from "../procedures/auth/runtime.ts";

const versionSchema = z.string().trim().min(1).max(100).optional();

export const feedbackRouter = {
  submit: publicProcedure
    .meta({ rateLimit: { limit: 3, windowMs: 600_000 } })
    .input(
      z.object({
        message: z.string().trim().min(1).max(5000),
        email: z.email().max(320).optional(),
        androidVersion: versionSchema,
        appVersion: versionSchema,
        maplibreVersion: versionSchema,
        serverVersion: versionSchema,
      }),
    )
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
