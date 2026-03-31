import { accountRouter } from "./router/accountRouter.ts";
import { authRouter } from "./router/authRouter.ts";
import { groupEpochRouter } from "./router/group/groupEpochRouter.ts";
import { groupInvitesRouter } from "./router/group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./router/group/groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./router/group/groupMembershipRouter.ts";
import { groupSettingsRouter } from "./router/group/groupSettingsRouter.ts";
import { mapsRouter } from "./router/mapsRouter.ts";
import { createTRPCRouter } from "./trpcRuntime.ts";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  groupSettings: groupSettingsRouter,
  groupLifecycle: groupLifecycleRouter,
  groupInvites: groupInvitesRouter,
  groupEpoch: groupEpochRouter,
  groupMembership: groupMembershipRouter,
  auth: authRouter,
  maps: mapsRouter,
});

export type AppRouter = typeof appRouter;
