import type { OpenBeaconCache } from "@openbeacon/cache";
import type { AccountNoticeType, Prisma, PrismaClient } from "@openbeacon/database";
import {
  type SecurityAlert,
  securityAlertSettings,
  type sendSecurityAlertEmail as sendAlert,
  type TurnedOffNotification,
} from "@openbeacon/email";
import {
  effectiveNotificationSetting,
  notificationChannelSchema,
  notificationTypeSchema,
} from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";

export const findAlertRecipient = async (
  db: Pick<Prisma.TransactionClient, "user">,
  userId: string,
) => {
  const user = await db.user.findUnique({
    select: {
      accounts: {
        select: { id: true },
        where: { providerId: "credential", password: { not: null } },
      },
      email: true,
      id: true,
      notificationSettings: { select: { type: true, email: true, phone: true } },
      timezone: true,
    },
    where: { id: userId },
  });
  if (!user) return null;
  const { accounts, ...recipient } = user;
  return { ...recipient, hasPassword: accounts.length > 0 };
};

type AlertRecipient = NonNullable<Awaited<ReturnType<typeof findAlertRecipient>>>;

export const createSecurityAlerts = ({
  db,
  sendSecurityAlertEmail,
  now = () => new Date(),
  runInBackground = () => {},
  alertsTurnedOff,
  setTimer = (callback, ms) => {
    setTimeout(callback, ms);
  },
}: {
  db: Pick<PrismaClient, "user" | "accountNotice">;
  sendSecurityAlertEmail: ((email: Parameters<typeof sendAlert>[0]) => Promise<unknown>) | null;
  now?: () => Date;
  runInBackground?: (task: Promise<unknown>) => void;
  alertsTurnedOff?: OpenBeaconCache["alertsTurnedOff"];
  setTimer?: (callback: () => void, ms: number) => void;
}) => {
  const alertsTurnedOffDelayMs = 60_000;
  const logError = (message: string) =>
    console.error(`${new Date().toISOString()} [security-alert] ${message}`);
  const background = (task: Promise<unknown>, failure: string) =>
    runInBackground(
      tryCatch(task).then((result) => {
        if (result.error) logError(failure);
      }),
    );
  const deliver = (
    alert: SecurityAlert,
    findRecipient: () => Promise<AlertRecipient | null>,
    at = now(),
    excludeDeviceId: string | null = null,
  ) => {
    const send = async () => {
      const recipient = await findRecipient();
      if (!recipient) return;
      const setting = securityAlertSettings[alert.type];
      const enabled = setting
        ? effectiveNotificationSetting(
            setting,
            recipient.notificationSettings.find(({ type }) => type === setting),
          )
        : null;
      const noticeType = accountNoticeTypes[alert.type];
      const device = "device" in alert ? alert.device : null;
      await Promise.all([
        noticeType && enabled?.phone
          ? db.accountNotice.create({
              data: {
                userId: recipient.id,
                type: noticeType,
                excludeDeviceId,
                deviceName:
                  alert.type === "device-removed" || alert.type === "other-sessions-signed-out"
                    ? (alert.device?.name ?? null)
                    : null,
                deviceModel: device?.model ?? null,
                devicePlatform: device?.platform ?? null,
                deletionDate: alert.type === "deletion-scheduled" ? alert.deletionDate : null,
              },
            })
          : null,
        sendSecurityAlertEmail && (enabled?.email ?? true)
          ? sendSecurityAlertEmail({
              alert,
              at,
              timezone: recipient.timezone,
              hasPassword: recipient.hasPassword,
              to: recipient.email,
              userId: recipient.id,
            })
          : null,
      ]);
    };
    background(send(), `could not send ${alert.type}`);
  };
  const sendAlertsTurnedOff = async (userId: string) => {
    const taken = await alertsTurnedOff?.take({
      userId,
      firstAtOrBefore: now().getTime() - alertsTurnedOffDelayMs,
    });
    if (!taken) return;
    const alerts = taken.alerts.flatMap(parseTurnedOff);
    if (!alerts.length) return;
    deliver(
      { type: "alerts-turned-off", alerts },
      () => findAlertRecipient(db, userId),
      new Date(taken.firstAt),
    );
  };
  const scheduled = new Set<string>();
  const scheduleAlertsTurnedOff = (userId: string, firstAt: number) => {
    const id = `${userId}:${firstAt}`;
    if (scheduled.has(id)) return;
    scheduled.add(id);
    setTimer(
      () => {
        scheduled.delete(id);
        background(sendAlertsTurnedOff(userId), "could not send alerts-turned-off");
      },
      Math.max(0, firstAt + alertsTurnedOffDelayMs - now().getTime()),
    );
  };
  return {
    send: (userId: string, alert: SecurityAlert, excludeDeviceId: string | null = null) =>
      deliver(alert, () => findAlertRecipient(db, userId), now(), excludeDeviceId),
    sendTo: (recipient: AlertRecipient, alert: SecurityAlert) =>
      deliver(alert, async () => recipient),
    turnedOff: (userId: string, alerts: TurnedOffNotification[]) => {
      const at = now();
      const sendNow = () =>
        deliver({ type: "alerts-turned-off", alerts }, () => findAlertRecipient(db, userId), at);
      if (!alertsTurnedOff) return sendNow();
      const hold = async () => {
        const added = await tryCatch(
          alertsTurnedOff.add({
            userId,
            alerts: alerts.map(({ type, channel }) => `${type}:${channel}`),
            at: at.getTime(),
          }),
        );
        if (!added.error) return scheduleAlertsTurnedOff(userId, added.data);
        logError("could not hold alerts-turned-off, so sending it now");
        sendNow();
      };
      runInBackground(hold());
    },
    schedulePendingAlertsTurnedOff: () => {
      if (!alertsTurnedOff) return;
      runInBackground(
        tryCatch(alertsTurnedOff.pending()).then((pending) => {
          if (pending.error) {
            logError(`could not load pending alerts-turned-off: ${pending.error.message}`);
            return;
          }
          for (const { userId, firstAt } of pending.data) scheduleAlertsTurnedOff(userId, firstAt);
        }),
      );
    },
  };
};

export type SecurityAlerts = ReturnType<typeof createSecurityAlerts>;

const accountNoticeTypes = {
  "new-sign-in": "NEW_SIGN_IN",
  "password-changed": "PASSWORD_CHANGED",
  "password-reset": "PASSWORD_RESET",
  "recovery-phrase-changed": "RECOVERY_PHRASE_CHANGED",
  "recovery-phrase-reset": "RECOVERY_PHRASE_RESET",
  "other-sessions-signed-out": "OTHER_SESSIONS_SIGNED_OUT",
  "device-removed": "DEVICE_REMOVED",
  "deletion-scheduled": "DELETION_SCHEDULED",
  "account-deleted": null,
  "alerts-turned-off": null,
} as const satisfies Record<SecurityAlert["type"], AccountNoticeType | null>;

const parseTurnedOff = (held: string): TurnedOffNotification[] => {
  const [heldType = "", heldChannel = "email"] = held.split(":");
  const type = notificationTypeSchema.safeParse(
    { "new-sign-in": "NEW_SIGN_IN", "deletion-scheduled": "DELETION_SCHEDULED" }[heldType] ??
      heldType,
  );
  const channel = notificationChannelSchema.safeParse(heldChannel);
  if (!type.success || !channel.success) return [];
  return [{ type: type.data, channel: channel.data }];
};
