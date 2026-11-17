import { notificationTypes } from "@openbeacon/schemas";
import { Text } from "@react-email/components";
import { EmailDetails, EmailSubheading, renderEmailLayout } from "./layout.tsx";
import type { EmailMessage, TurnedOffNotification } from "./types.ts";

export const renderAlertsTurnedOffEmail = async ({
  alerts,
  happenedAt,
  signedInAdvice,
  serverName,
}: {
  alerts: TurnedOffNotification[];
  happenedAt: string;
  signedInAdvice: string;
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  if (!alerts.length) throw new Error("At least one turned off alert is required");
  const labels = (Object.keys(notificationTypes) as TurnedOffNotification["type"][]).flatMap(
    (type) => {
      const email = alerts.some((alert) => alert.type === type && alert.channel === "email");
      const phone = alerts.some((alert) => alert.type === type && alert.channel === "phone");
      if (!email && !phone) return [];
      const channels =
        email && phone ? "email and phone notifications" : email ? "email" : "phone notifications";
      return [`${notificationTypes[type].label} (${channels})`];
    },
  );
  const several = labels.length > 1;
  const happened = several ? "These alerts were turned off:" : "This alert was turned off:";
  const rendered = await renderEmailLayout({
    serverName,
    title: "Alerts turned off",
    preview: `${happened} ${labels.join(", ")}.`,
    children: (
      <>
        <Text style={{ margin: "0 0 8px" }}>{happened}</Text>
        <ul style={{ margin: "0 0 16px", paddingLeft: "24px" }}>
          {labels.map((label) => (
            <li key={label} style={{ margin: "0 0 4px" }}>
              {label}
            </li>
          ))}
        </ul>
        <EmailDetails rows={[{ label: "Turned off at", value: happenedAt }]} />
        <EmailSubheading>If this wasn't you</EmailSubheading>
        <Text style={{ margin: 0 }}>
          {`${signedInAdvice} Then turn ${several ? "these alerts" : "this alert"} back on in Account → Notifications.`}
        </Text>
      </>
    ),
  });
  return {
    subject: "Alerts were turned off on your OpenBeacon account",
    summary: { type: "alert:alerts-turned-off" },
    ...rendered,
  };
};
