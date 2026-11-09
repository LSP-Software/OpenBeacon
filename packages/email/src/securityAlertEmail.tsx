import { timezoneSchema } from "@openbeacon/schemas";
import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";
import type { createSendEmail } from "./sender.ts";
import { type EmailMessage, isOptionalSecurityAlert, type SecurityAlert } from "./types.ts";

const alertCopy = (
  alert: SecurityAlert,
  happenedAt: string,
  formatTime: (date: Date) => string,
  hasPassword: boolean,
): { subject: string; happened: string; ifNotYou: string } => {
  const secureAccountAdvice = hasPassword
    ? "change your password in Account → Password and Security. That signs you out on every other device."
    : "secure your Google account, because someone may have used it to sign in.";
  const signedInAdvice = `If this wasn't you, someone else is signed in to your account. In the OpenBeacon app, ${secureAccountAdvice}`;
  switch (alert.type) {
    case "password-changed":
      return {
        subject: "Your OpenBeacon password was changed",
        happened: `Your OpenBeacon password was changed on ${happenedAt}.`,
        ifNotYou:
          "If this wasn't you, use \"Forgot password\" on the app's sign-in screen to choose a new password. That signs you out on every other device.",
      };
    case "password-reset":
      return {
        subject: "Your OpenBeacon password was reset",
        happened: `Your OpenBeacon password was reset on ${happenedAt}, and every device was signed out.`,
        ifNotYou:
          "If this wasn't you, someone may be able to read your email. Secure your email account, then use \"Forgot password\" on the app's sign-in screen to choose a new password.",
      };
    case "recovery-phrase-changed":
      return {
        subject: "Your OpenBeacon recovery phrase was changed",
        happened: `Your OpenBeacon recovery phrase was changed on ${happenedAt}. Your old phrase no longer works.`,
        ifNotYou: `${signedInAdvice} Then open Account → Recovery phrase and tap Change recovery phrase.`,
      };
    case "recovery-phrase-reset":
      return {
        subject: "Your OpenBeacon recovery phrase was reset",
        happened: `Your OpenBeacon recovery phrase was reset on ${happenedAt}. Your old phrase no longer works.`,
        ifNotYou: `${signedInAdvice} Then open Account → Recovery phrase and tap "I’ve lost my phrase" to set a new one.`,
      };
    case "new-device": {
      const platform =
        alert.device.platform && { android: "Android", ios: "iOS" }[alert.device.platform];
      const device =
        alert.device.model && platform
          ? `${alert.device.model} (${platform})`
          : (alert.device.model ?? (platform ? `an ${platform} device` : "a device"));
      return {
        subject: "A new device was added to your OpenBeacon account",
        happened: `A new device was added to your OpenBeacon account on ${happenedAt}: ${device}.`,
        ifNotYou: `If this wasn't you, ${secureAccountAdvice}`,
      };
    }
    case "deletion-scheduled":
      return {
        subject: "Your OpenBeacon account is scheduled for deletion",
        happened: `Your OpenBeacon account was scheduled for deletion on ${happenedAt}. It will be deleted on ${formatTime(alert.deletionDate)}. Signing in to the app before then cancels the deletion.`,
        ifNotYou: `If this wasn't you, sign in to the app now to cancel it. Then ${secureAccountAdvice}`,
      };
    case "alerts-turned-off": {
      const labels = alert.alerts.map(
        (type) =>
          ({
            "new-device": "New device added",
            "deletion-scheduled": "Account deletion scheduled",
          })[type],
      );
      return {
        subject: "Email alerts were turned off on your OpenBeacon account",
        happened: `These email alerts were turned off on ${happenedAt}: ${labels.join(" and ")}.`,
        ifNotYou: `${signedInAdvice} Then turn the alerts back on in Account → Email alerts.`,
      };
    }
    case "account-deleted":
      return {
        subject: "Your OpenBeacon account was deleted",
        happened: `Your OpenBeacon account and its data were deleted from this server on ${happenedAt}.`,
        ifNotYou: `If you didn't ask for this, someone else could sign in to your account. Deleted accounts can't be restored. ${
          hasPassword
            ? "If you used your OpenBeacon password anywhere else, change it there."
            : "Secure your Google account, because someone may have used it to sign in."
        }`,
      };
  }
};

export const renderSecurityAlertEmail = async ({
  alert,
  at,
  timezone,
  hasPassword,
  serverName,
}: {
  alert: SecurityAlert;
  at: Date;
  timezone: string | null;
  hasPassword: boolean;
  serverName: string;
}): Promise<Omit<EmailMessage, "to"> & { canTurnOff: boolean }> => {
  const formatTime = (date: Date) => formatAlertTime(date, timezone);
  const { subject, happened, ifNotYou } = alertCopy(alert, formatTime(at), formatTime, hasPassword);
  const canTurnOff = isOptionalSecurityAlert(alert.type);
  const rendered = await renderEmailLayout({
    serverName,
    preview: happened,
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>{happened}</Text>
        <Text style={{ margin: 0 }}>{ifNotYou}</Text>
      </>
    ),
    ...(canTurnOff
      ? { footerNote: "You can turn off this alert in the app under Account → Email alerts." }
      : {}),
  });
  return { subject, ...rendered, canTurnOff };
};

export const createSendSecurityAlertEmail =
  ({
    sendEmail,
    serverName,
  }: {
    sendEmail: ReturnType<typeof createSendEmail>;
    serverName: string;
  }) =>
  async ({
    to,
    userId,
    ...alert
  }: Omit<Parameters<typeof renderSecurityAlertEmail>[0], "serverName"> & {
    to: string;
    userId: string;
  }) => {
    const { canTurnOff, ...email } = await renderSecurityAlertEmail({ ...alert, serverName });
    return sendEmail({ to, ...email, userId, optional: canTurnOff });
  };

export const formatAlertTime = (date: Date, timezone: string | null) => {
  const zone = timezone && timezoneSchema.safeParse(timezone).success ? timezone : "UTC";
  const format = (timeZone: string, withDate: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      ...(withDate ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : {}),
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(date);
  const local = format(zone, true);
  if (
    date.toLocaleString("en-GB", { timeZone: zone }) ===
    date.toLocaleString("en-GB", { timeZone: "UTC" })
  ) {
    return local;
  }
  const sameDay =
    date.toLocaleDateString("en-GB", { timeZone: zone }) ===
    date.toLocaleDateString("en-GB", { timeZone: "UTC" });
  return `${local} (${format("UTC", !sameDay)})`;
};
