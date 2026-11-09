import type { Prisma, PrismaClient } from "@openbeacon/database";
import {
  isOptionalSecurityAlert,
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
}: {
  db: Pick<PrismaClient, "user">;
  sendSecurityAlertEmail: (email: Parameters<typeof sendAlert>[0]) => Promise<unknown>;
  now?: () => Date;
  runInBackground?: (task: Promise<unknown>) => void;
}) => {
  const deliver = (alert: SecurityAlert, findRecipient: () => Promise<AlertRecipient | null>) => {
    const at = now();
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
    runInBackground(
      tryCatch(send()).then((result) => {
        if (result.error) console.error(`[security-alert] could not send ${alert.type}`);
      }),
    );
  };
  return {
    send: (userId: string, alert: SecurityAlert) =>
      deliver(alert, () => findAlertRecipient(db, userId)),
    sendTo: (recipient: AlertRecipient, alert: SecurityAlert) =>
      deliver(alert, async () => recipient),
  };
};

export type SecurityAlerts = ReturnType<typeof createSecurityAlerts>;
