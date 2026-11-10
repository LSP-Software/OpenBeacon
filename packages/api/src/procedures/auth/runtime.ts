import { auth } from "@openbeacon/auth";
import { TRPCError } from "@trpc/server";
import { t } from "../../trpcRuntime.ts";
import { createAuthProcedures } from "./base.ts";

const procedures = createAuthProcedures({ t });

export const protectedProcedure = procedures.protectedProcedure;
export const publicProcedure = procedures.publicProcedure;

export const isSessionFresh = async (sessionCreatedAt: Date) => {
  const { sessionConfig } = await auth.$context;
  const sessionAge = Date.now() - new Date(sessionCreatedAt).getTime();
  return sessionConfig.freshAge === 0 || sessionAge < sessionConfig.freshAge * 1000;
};

export const freshSessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isSessionFresh(ctx.session.session.createdAt))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again to continue." });
  }
  return next();
});
