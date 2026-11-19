import { Text } from "@react-email/components";
import { EmailSubheading, renderEmailLayout } from "./layout.tsx";
import { formatAlertTime } from "./securityAlertEmail.tsx";
import type { EmailMessage } from "./types.ts";

export const renderSeatsEndedEmail = async ({
  endedAt,
  holds,
  serverName,
  timezone,
}: {
  endedAt: Date;
  holds: { groupId: string; groupName: string; memberName: string; deviceName: string }[];
  serverName: string;
  timezone: string | null;
}): Promise<Omit<EmailMessage, "to">> => {
  if (!holds.length) throw new Error("At least one phone on hold is required");
  const groups = [...new Map(holds.map(({ groupId, groupName }) => [groupId, groupName]))];
  const rendered = await renderEmailLayout({
    serverName,
    title: "Your seats have ended",
    preview: `${holds.length} ${holds.length === 1 ? "phone is" : "phones are"} on hold.`,
    children: (
      <>
        <Text style={{ margin: "0 0 8px" }}>
          {`Your seats ended on ${formatAlertTime(endedAt, timezone)} and these phones are on hold until you renew:`}
        </Text>
        {groups.map(([groupId, groupName]) => (
          <div key={groupId}>
            <Text style={{ margin: "0 0 4px", fontWeight: 600 }}>{groupName}</Text>
            <ul style={{ margin: "0 0 16px", paddingLeft: "24px" }}>
              {holds
                .filter((hold) => hold.groupId === groupId)
                .map(({ memberName, deviceName }) => (
                  <li key={`${memberName}\u0000${deviceName}`} style={{ margin: "0 0 4px" }}>
                    {`${memberName} (${deviceName})`}
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <EmailSubheading>What a hold means</EmailSubheading>
        <Text style={{ margin: "0 0 16px" }}>
          A phone on hold stops sharing its location with that group, can't see anyone in it and
          clears the locations it was waiting to send there. Your groups' history isn't deleted, and
          everyone can still pause sharing, leave the group or delete their account.
        </Text>
        <EmailSubheading>Start sharing again</EmailSubheading>
        <Text style={{ margin: 0 }}>Renew your seats and sharing starts again on its own.</Text>
      </>
    ),
  });
  return {
    subject: "Phones in your OpenBeacon groups are on hold",
    summary: { type: "seats:ended" },
    ...rendered,
  };
};
