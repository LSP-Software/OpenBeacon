import { accountRouter } from "./router/accountRouter.ts";
import { groupsRouter } from "./router/groupsRouter.ts";
import { createTRPCRouter } from "./trpc.ts";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  groups: groupsRouter,
});

export type AppRouter = typeof appRouter;
