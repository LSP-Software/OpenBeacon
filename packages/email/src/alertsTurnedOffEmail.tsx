import { Text } from "@react-email/components";
import { EmailDetails, EmailSubheading, renderEmailLayout } from "./layout.tsx";
import type { EmailMessage, OptionalSecurityAlert } from "./types.ts";

export const renderAlertsTurnedOffEmail = async ({
  alerts,
  happenedAt,
  signedInAdvice,
  serverName,
}: {
  alerts: OptionalSecurityAlert[];
  happenedAt: string;
  signedInAdvice: string;
  serverName: string;
}): Promise<Omit<EmailMessage, "to">> => {
  if (!alerts.length) throw new Error("At least one turned off alert is required");
  const labels = alerts.map(
    (type) =>
      ({
        "new-device": "New sign-in",
        "deletion-scheduled": "Account deletion scheduled",
      })[type],
  );
  const several = labels.length > 1;
  const happened = several
    ? "These email alerts were turned off:"
    : "This email alert was turned off:";
  const rendered = await renderEmailLayout({
    serverName,
    title: "Email alerts turned off",
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
          {`${signedInAdvice} Then turn ${several ? "these alerts" : "this alert"} back on in Account → Notifications → Email alerts.`}
        </Text>
      </>
    ),
  });
  return {
    subject: "Email alerts were turned off on your OpenBeacon account",
    summary: { type: "alert:alerts-turned-off" },
    ...rendered,
  };
};
