import { accountNoticesRouter } from "./router/accountNoticesRouter.ts";
import { accountHistoryRouter } from "./router/accountHistoryRouter.ts";
import { accountRecoveryRouter } from "./router/accountRecoveryRouter.ts";
import { accountRouter } from "./router/accountRouter.ts";
import { authRouter } from "./router/authRouter.ts";
import { deviceLinkRouter } from "./router/deviceLinkRouter.ts";
import { deviceRouter } from "./router/deviceRouter.ts";
import { crashAlertsRouter } from "./router/crashAlertsRouter.ts";
import { drivesRouter } from "./router/drivesRouter.ts";
import { emailAlertsRouter } from "./router/emailAlertsRouter.ts";
import { feedbackRouter } from "./router/feedbackRouter.ts";
import { groupImageKeysRouter } from "./router/group/groupImageKeysRouter.ts";
import { groupHistoryRouter } from "./router/group/groupHistoryRouter.ts";
import { groupEpochRouter } from "./router/group/groupEpochRouter.ts";
import { groupInvitesRouter } from "./router/group/groupInvitesRouter.ts";
import { groupLifecycleRouter } from "./router/group/groupLifecycleRouter.ts";
import { groupMembershipRouter } from "./router/group/groupMembershipRouter.ts";
import { groupPlacesRouter } from "./router/group/groupPlacesRouter.ts";
import { groupSettingsRouter } from "./router/group/groupSettingsRouter.ts";
import { groupTrackingRouter } from "./router/group/groupTrackingRouter.ts";
import { placeAlertsRouter } from "./router/group/placeAlertsRouter.ts";
import { placeSharingRouter } from "./router/group/placeSharingRouter.ts";
import { placeTransitionsRouter } from "./router/group/placeTransitionsRouter.ts";
import { mapsRouter } from "./router/mapsRouter.ts";
import { notificationSettingsRouter } from "./router/notificationSettingsRouter.ts";
import { signInCodesRouter } from "./router/signInCodesRouter.ts";
import { createTRPCRouter } from "./trpcRuntime.ts";

export const appRouter = createTRPCRouter({
  account: accountRouter,
  accountHistory: accountHistoryRouter,
  accountNotices: accountNoticesRouter,
  accountRecovery: accountRecoveryRouter,
  groupSettings: groupSettingsRouter,
  groupLifecycle: groupLifecycleRouter,
  groupInvites: groupInvitesRouter,
  groupEpoch: groupEpochRouter,
  groupHistory: groupHistoryRouter,
  groupImageKeys: groupImageKeysRouter,
  groupMembership: groupMembershipRouter,
  groupPlaces: groupPlacesRouter,
  groupTracking: groupTrackingRouter,
  auth: authRouter,
  device: deviceRouter,
  deviceLink: deviceLinkRouter,
  crashAlerts: crashAlertsRouter,
  drives: drivesRouter,
  emailAlerts: emailAlertsRouter,
  feedback: feedbackRouter,
  maps: mapsRouter,
  notificationSettings: notificationSettingsRouter,
  placeAlerts: placeAlertsRouter,
  placeSharing: placeSharingRouter,
  placeTransitions: placeTransitionsRouter,
  signInCodes: signInCodesRouter,
});

export type AppRouter = typeof appRouter;
