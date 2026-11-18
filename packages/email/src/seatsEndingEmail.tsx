import { Text } from "@react-email/components";
import { EmailSubheading, renderEmailLayout } from "./layout.tsx";
import { formatAlertTime } from "./securityAlertEmail.tsx";
import type { EmailMessage } from "./types.ts";

export const renderSeatsEndingEmail = async ({
  holds,
  holdsFrom,
  reminder,
  serverName,
  timezone,
}: {
  holds: { groupName: string; memberName: string; deviceName: string }[];
  holdsFrom: Date;
  reminder: boolean;
  serverName: string;
  timezone: string | null;
}): Promise<Omit<EmailMessage, "to">> => {
  if (!holds.length) throw new Error("At least one phone going on hold is required");
  const when = formatAlertTime(holdsFrom, timezone);
  const groups = [...new Set(holds.map(({ groupName }) => groupName))];
  const title = reminder ? "Holds start tomorrow" : "Your seats have ended";
  const intro = reminder
    ? `Your groups keep working until ${when}. Then these phones go on hold:`
    : `Your groups keep working as they are until ${when}. Then these phones go on hold:`;
  const rendered = await renderEmailLayout({
    serverName,
    title,
    preview: `${holds.length} ${holds.length === 1 ? "phone goes" : "phones go"} on hold on ${when}.`,
    children: (
      <>
        <Text style={{ margin: "0 0 8px" }}>{intro}</Text>
        {groups.map((groupName) => (
          <div key={groupName}>
            <Text style={{ margin: "0 0 4px", fontWeight: 600 }}>{groupName}</Text>
            <ul style={{ margin: "0 0 16px", paddingLeft: "24px" }}>
              {holds
                .filter((hold) => hold.groupName === groupName)
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
          A phone on hold stops sharing its location with that group and can't see anyone in it.
          Nothing is deleted, and everyone can still pause sharing, leave the group or delete their
          account.
        </Text>
        <EmailSubheading>Keep them sharing</EmailSubheading>
        <Text style={{ margin: 0 }}>
          Renew your seats before then. If phones are already on hold, sharing starts again on its
          own as soon as you add seats.
        </Text>
      </>
    ),
  });
  return {
    subject: reminder
      ? "Phones in your OpenBeacon groups go on hold tomorrow"
      : "Your OpenBeacon seats have ended",
    summary: { type: reminder ? "seats:ending-soon" : "seats:ending" },
    ...rendered,
  };
};
