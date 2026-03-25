import { authCapabilities } from "@openbeacon/auth";
import { publicProcedure } from "../procedures/auth/base.ts";
import { createTRPCRouter } from "../trpc.ts";

export const authRouter = createTRPCRouter({
  providers: publicProcedure.query(() => authCapabilities),
});
