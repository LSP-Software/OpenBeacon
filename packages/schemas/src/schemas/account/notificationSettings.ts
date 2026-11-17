import { NotificationType } from "@openbeacon/database/enums";
import z from "zod";

export const notificationTypes = {
  PLACE_ALERTS: {
    section: "places",
    label: "Place arrivals and departures",
    hasEmail: false,
    defaultOn: true,
  },
  MEMBER_JOINED: {
    section: "groups",
    label: "Someone joined a group",
    hasEmail: false,
    defaultOn: true,
  },
  MEMBER_LEFT: {
    section: "groups",
    label: "Someone left or was removed",
    hasEmail: false,
    defaultOn: true,
  },
  ROLE_CHANGED: { section: "groups", label: "Role changed", hasEmail: false, defaultOn: false },
  NEW_SIGN_IN: { section: "security", label: "New sign-in", hasEmail: true, defaultOn: true },
  PASSWORD_CHANGED: {
    section: "security",
    label: "Password changed or reset",
    hasEmail: true,
    defaultOn: true,
  },
  RECOVERY_PHRASE_CHANGED: {
    section: "security",
    label: "Recovery phrase changed or reset",
    hasEmail: true,
    defaultOn: true,
  },
  OTHER_SESSIONS_SIGNED_OUT: {
    section: "security",
    label: "Other sessions signed out",
    hasEmail: true,
    defaultOn: true,
  },
  DEVICE_REMOVED: { section: "security", label: "Device removed", hasEmail: true, defaultOn: true },
  DELETION_SCHEDULED: {
    section: "security",
    label: "Account deletion scheduled",
    hasEmail: true,
    defaultOn: true,
  },
} as const satisfies Record<
  NotificationType,
  {
    section: "places" | "groups" | "security";
    label: string;
    hasEmail: boolean;
    defaultOn: boolean;
  }
>;

export const notificationTypeSchema = z.enum(NotificationType);

export const notificationChannelSchema = z.enum(["email", "phone"]);

export const setNotificationSettingSchema = z
  .object({
    type: notificationTypeSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
  })
  .refine(
    ({ type, channel }) => channel === "phone" || notificationTypes[type].hasEmail,
    "This message type has no email.",
  );

export const effectiveNotificationSetting = (
  type: NotificationType,
  stored: { email: boolean; phone: boolean } | undefined,
) => ({
  email: notificationTypes[type].hasEmail
    ? (stored?.email ?? notificationTypes[type].defaultOn)
    : null,
  phone: stored?.phone ?? notificationTypes[type].defaultOn,
});
