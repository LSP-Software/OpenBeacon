import { authRouter } from "./router/authRouter.ts";
import { groupsRouter } from "./router/groupsRouter.ts";
import { mapsRouter } from "./router/mapsRouter.ts";
import { createTRPCRouter } from "./trpc.ts";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  groups: groupsRouter,
  maps: mapsRouter,
});

export type AppRouter = typeof appRouter;
