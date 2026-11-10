import { timezoneSchema } from "@openbeacon/schemas";
import { Text } from "@react-email/components";
import { renderAlertsTurnedOffEmail } from "./alertsTurnedOffEmail.tsx";
import { EmailDetails, EmailSubheading, renderEmailLayout } from "./layout.tsx";
import type { createSendEmail } from "./sender.ts";
import { type EmailMessage, isOptionalSecurityAlert, type SecurityAlert } from "./types.ts";

const secureGoogleAdvice =
  "Change your Google password, because someone may have used your Google account to sign in.";

const signOutOthersAdvice = 'open Account and tap "Sign out of all other sessions".';

const secureAccountAdvice = (hasPassword: boolean) =>
  hasPassword
    ? "In the OpenBeacon app, change your password in Account → Password and Security. That signs out every other device."
    : `${secureGoogleAdvice} After that, in the OpenBeacon app, ${signOutOthersAdvice}`;

const signedInAdvice = (hasPassword: boolean) =>
  `Someone else is signed in to your account. ${secureAccountAdvice(hasPassword)}`;

const alertCopy = (
  alert: Exclude<SecurityAlert, { type: "alerts-turned-off" }>,
  happenedAt: string,
  formatTime: (date: Date) => string,
  hasPassword: boolean,
): {
  subject: string;
  title: string;
  happened: string;
  details: { label: string; value: string }[];
  ifNotYou: string | null;
} => {
  switch (alert.type) {
    case "password-changed":
      return {
        subject: "Your OpenBeacon password was changed",
        title: "Password changed",
        happened: "Your OpenBeacon password was changed.",
        details: [{ label: "Changed at", value: happenedAt }],
        ifNotYou:
          'Use "Forgot password" on the app\'s sign-in screen to choose a new password. That signs out every other device.',
      };
    case "password-reset":
      return {
        subject: "Your OpenBeacon password was reset",
        title: "Password reset",
        happened: "Your OpenBeacon password was reset, and every device was signed out.",
        details: [{ label: "Reset at", value: happenedAt }],
        ifNotYou:
          'Someone may be able to read your email. Secure your email account, then use "Forgot password" on the app\'s sign-in screen to choose a new password.',
      };
    case "recovery-phrase-changed":
      return {
        subject: "Your OpenBeacon recovery phrase was changed",
        title: "Recovery phrase changed",
        happened: "Your OpenBeacon recovery phrase was changed. Your old phrase no longer works.",
        details: [{ label: "Changed at", value: happenedAt }],
        ifNotYou: `${signedInAdvice(hasPassword)} Then open Account → Recovery phrase and tap Change recovery phrase.`,
      };
    case "recovery-phrase-reset":
      return {
        subject: "Your OpenBeacon recovery phrase was reset",
        title: "Recovery phrase reset",
        happened: "Your OpenBeacon recovery phrase was reset. Your old phrase no longer works.",
        details: [{ label: "Reset at", value: happenedAt }],
        ifNotYou: `${signedInAdvice(hasPassword)} Then open Account → Recovery phrase and tap "I’ve lost my phrase" to set a new one.`,
      };
    case "other-sessions-signed-out":
      return {
        subject: "Your other OpenBeacon sessions were signed out",
        title: "Other sessions signed out",
        happened:
          "Every other device signed in to your OpenBeacon account was signed out. Only the device that did this is still signed in.",
        details: [{ label: "Signed out at", value: happenedAt }],
        ifNotYou: `Someone else is signed in to your account and may have signed you out. ${
          hasPassword
            ? 'Use "Forgot password" on the app\'s sign-in screen to choose a new password. That signs out every other device, including theirs.'
            : `${secureGoogleAdvice} After that, sign in to the OpenBeacon app, ${signOutOthersAdvice}`
        }`,
      };
    case "new-device": {
      const platform =
        alert.device.platform && { android: "Android", ios: "iOS" }[alert.device.platform];
      const device =
        alert.device.model && platform
          ? `${alert.device.model} (${platform})`
          : (alert.device.model ?? (platform ? `${platform} device` : null));
      return {
        subject: "A new device was added to your OpenBeacon account",
        title: "New device added",
        happened: "A new device was added to your OpenBeacon account.",
        details: [
          ...(device ? [{ label: "Device", value: device }] : []),
          { label: "Added at", value: happenedAt },
        ],
        ifNotYou: signedInAdvice(hasPassword),
      };
    }
    case "deletion-scheduled":
      return {
        subject: "Your OpenBeacon account is scheduled for deletion",
        title: "Account deletion scheduled",
        happened:
          "Your OpenBeacon account is scheduled for deletion. Signing in to the app before then cancels the deletion.",
        details: [
          { label: "Requested at", value: happenedAt },
          { label: "Scheduled for", value: formatTime(alert.deletionDate) },
        ],
        ifNotYou: `Sign in to the app now to cancel it. ${secureAccountAdvice(hasPassword)}`,
      };
    case "account-deleted":
      return {
        subject: "Your OpenBeacon account was deleted",
        title: "Account deleted",
        happened: "Your OpenBeacon account and its data were deleted.",
        details: [{ label: "Deleted at", value: happenedAt }],
        ifNotYou: null,
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
  if (alert.type === "alerts-turned-off") {
    const email = await renderAlertsTurnedOffEmail({
      alerts: alert.alerts,
      happenedAt: formatTime(at),
      signedInAdvice: signedInAdvice(hasPassword),
      serverName,
    });
    return { ...email, canTurnOff: false };
  }
  const { subject, title, happened, details, ifNotYou } = alertCopy(
    alert,
    formatTime(at),
    formatTime,
    hasPassword,
  );
  const canTurnOff = isOptionalSecurityAlert(alert.type);
  const rendered = await renderEmailLayout({
    serverName,
    title,
    preview: happened,
    children: (
      <>
        <Text style={{ margin: "0 0 16px" }}>{happened}</Text>
        <EmailDetails rows={details} />
        {ifNotYou && (
          <>
            <EmailSubheading>If this wasn't you</EmailSubheading>
            <Text style={{ margin: 0 }}>{ifNotYou}</Text>
          </>
        )}
      </>
    ),
    ...(canTurnOff
      ? {
          footerNote:
            "To choose which emails you get, open the OpenBeacon app and go to Account → Notifications → Email alerts.",
        }
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
