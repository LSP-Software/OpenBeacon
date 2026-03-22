import { authCapabilities } from "@openbeacon/auth";
import { createTRPCRouter, publicProcedure } from "../trpc.ts";

export const authRouter = createTRPCRouter({
  providers: publicProcedure.query(() => authCapabilities),
});
