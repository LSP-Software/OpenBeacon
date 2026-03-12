import { groupsRouter } from "./router/groupsRouter.ts";
import { createTRPCRouter } from "./trpc.ts";

export const appRouter = createTRPCRouter({
  groups: groupsRouter,
});

export type AppRouter = typeof appRouter;
