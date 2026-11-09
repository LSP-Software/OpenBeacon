import type { OpenBeaconCache } from "@openbeacon/cache";
import type { Prisma, PrismaClient } from "@openbeacon/database";
import {
  isOptionalSecurityAlert,
  type OptionalSecurityAlert,
  optionalSecurityAlerts,
  type SecurityAlert,
  type sendSecurityAlertEmail as sendAlert,
} from "@openbeacon/email";
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
      alertDeletionScheduled: true,
      alertNewDevice: true,
      email: true,
      id: true,
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
  db: Pick<PrismaClient, "user">;
  sendSecurityAlertEmail: (email: Parameters<typeof sendAlert>[0]) => Promise<unknown>;
  now?: () => Date;
  runInBackground?: (task: Promise<unknown>) => void;
  alertsTurnedOff?: OpenBeaconCache["alertsTurnedOff"];
  setTimer?: (callback: () => void, ms: number) => void;
}) => {
  const alertsTurnedOffDelayMs = 60_000;
  const background = (task: Promise<unknown>, failure: string) =>
    runInBackground(
      tryCatch(task).then((result) => {
        if (result.error) console.error(`[security-alert] ${failure}`);
      }),
    );
  const deliver = (
    alert: SecurityAlert,
    findRecipient: () => Promise<AlertRecipient | null>,
    at = now(),
  ) => {
    const send = async () => {
      const recipient = await findRecipient();
      if (!recipient) return;
      if (isOptionalSecurityAlert(alert.type) && !recipient[optionalSecurityAlerts[alert.type]])
        return;
      await sendSecurityAlertEmail({
        alert,
        at,
        timezone: recipient.timezone,
        hasPassword: recipient.hasPassword,
        to: recipient.email,
        userId: recipient.id,
      });
    };
    background(send(), `could not send ${alert.type}`);
  };
  const sendAlertsTurnedOff = async (userId: string) => {
    const taken = await alertsTurnedOff?.take({
      userId,
      firstAtOrBefore: now().getTime() - alertsTurnedOffDelayMs,
    });
    if (!taken) return;
    const alerts = (Object.keys(optionalSecurityAlerts) as OptionalSecurityAlert[]).filter((type) =>
      taken.alerts.includes(type),
    );
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
    send: (userId: string, alert: SecurityAlert) =>
      deliver(alert, () => findAlertRecipient(db, userId)),
    sendTo: (recipient: AlertRecipient, alert: SecurityAlert) =>
      deliver(alert, async () => recipient),
    turnedOff: (userId: string, alerts: OptionalSecurityAlert[]) => {
      const at = now();
      const sendNow = () =>
        deliver({ type: "alerts-turned-off", alerts }, () => findAlertRecipient(db, userId), at);
      if (!alertsTurnedOff) return sendNow();
      const hold = async () => {
        const added = await tryCatch(alertsTurnedOff.add({ userId, alerts, at: at.getTime() }));
        if (!added.error) return scheduleAlertsTurnedOff(userId, added.data);
        console.error("[security-alert] could not hold alerts-turned-off, so sending it now");
        sendNow();
      };
      runInBackground(hold());
    },
    schedulePendingAlertsTurnedOff: () => {
      if (!alertsTurnedOff) return;
      background(
        alertsTurnedOff.pending().then((pending) => {
          for (const { userId, firstAt } of pending) scheduleAlertsTurnedOff(userId, firstAt);
        }),
        "could not load pending alerts-turned-off",
      );
    },
  };
};

export type SecurityAlerts = ReturnType<typeof createSecurityAlerts>;
