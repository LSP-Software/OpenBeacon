import { auth } from "@openbeacon/auth";
import { TRPCError } from "@trpc/server";
import { t } from "../../trpcRuntime.ts";
import { createAuthProcedures } from "./base.ts";

const procedures = createAuthProcedures({ t });

export const protectedProcedure = procedures.protectedProcedure;
export const publicProcedure = procedures.publicProcedure;

export const sessionFreshForMs = async (sessionCreatedAt: Date): Promise<number | null> => {
  const { sessionConfig } = await auth.$context;
  if (sessionConfig.freshAge === 0) return null;
  const sessionAge = Date.now() - new Date(sessionCreatedAt).getTime();
  return Math.max(0, sessionConfig.freshAge * 1000 - sessionAge);
};

export const freshSessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if ((await sessionFreshForMs(ctx.session.session.createdAt)) === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue." });
  }
  return next();
});
