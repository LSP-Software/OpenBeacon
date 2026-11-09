import { Text } from "@react-email/components";
import { renderEmailLayout } from "./layout.tsx";
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
        "new-device": "New device added",
        "deletion-scheduled": "Account deletion scheduled",
      })[type],
  );
  const several = labels.length > 1;
  const happened = several
    ? `These email alerts were turned off on ${happenedAt}:`
    : `This email alert was turned off on ${happenedAt}:`;
  const rendered = await renderEmailLayout({
    serverName,
    preview: `${happened} ${labels.join(", ")}.`,
    children: (
      <>
        <Text style={{ margin: "0 0 8px" }}>{happened}</Text>
        <ul style={{ margin: "0 0 16px", paddingLeft: "24px" }}>
          {labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
        <Text style={{ margin: 0 }}>
          {`${signedInAdvice} Then turn ${several ? "these alerts" : "this alert"} back on in Account → Email alerts.`}
        </Text>
      </>
    ),
  });
  return { subject: "Email alerts were turned off on your OpenBeacon account", ...rendered };
};
