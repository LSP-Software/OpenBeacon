import { groupInvitesRouter } from "./router/group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./router/group/groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./router/group/groupMembershipRouter.ts";
import { groupSettingsRouter } from "./router/group/groupSettingsRouter.ts";
import { authRouter } from "./router/authRouter.ts";
import { mapsRouter } from "./router/mapsRouter.ts";
import { createTRPCRouter } from "./trpc.ts";

export const appRouter = createTRPCRouter({
  groupSettings: groupSettingsRouter,
  groupLifecycle: groupLifecycleRouter,
  groupInvites: groupInvitesRouter,
  groupMembership: groupMembershipRouter,
  auth: authRouter,
  maps: mapsRouter,
});

export type AppRouter = typeof appRouter;
