import { Text } from "@react-email/components";
import { EmailSubheading, renderEmailLayout } from "./layout.tsx";
import { formatAlertTime } from "./securityAlertEmail.tsx";
import type { EmailMessage } from "./types.ts";

export const renderSeatsEndingEmail = async ({
  holds,
  holdsFrom,
  kind,
  serverName,
  timezone,
}: {
  holds: { groupId: string; groupName: string; memberName: string; deviceName: string }[];
  holdsFrom: Date;
  kind: "ending" | "reminder" | "ended";
  serverName: string;
  timezone: string | null;
}): Promise<Omit<EmailMessage, "to">> => {
  if (!holds.length) throw new Error("At least one phone going on hold is required");
  const when = formatAlertTime(holdsFrom, timezone);
  const groups = [...new Map(holds.map(({ groupId, groupName }) => [groupId, groupName]))];
  const phones = holds.length === 1 ? "phone" : "phones";
  const renewBefore =
    "Renew your seats before then. If phones are already on hold, sharing starts again on its own as soon as you add seats.";
  const goOnHold = `${holds.length} ${phones} ${holds.length === 1 ? "goes" : "go"} on hold on ${when}.`;
  const text = {
    ending: {
      title: "Your seats have ended",
      intro: `Your groups keep working as they are until ${when}. Then these phones go on hold:`,
      preview: goOnHold,
      renew: renewBefore,
      subject: "Your OpenBeacon seats have ended",
    },
    reminder: {
      title: "Holds start tomorrow",
      intro: `Your groups keep working until ${when}. Then these phones go on hold:`,
      preview: goOnHold,
      renew: renewBefore,
      subject: "Phones in your OpenBeacon groups go on hold tomorrow",
    },
    ended: {
      title: "Your seats have ended",
      intro: `Your seats ended on ${when} and these phones are on hold until you renew:`,
      preview: `${holds.length} ${phones} ${holds.length === 1 ? "is" : "are"} on hold.`,
      renew: "Renew your seats and sharing starts again on its own.",
      subject: "Phones in your OpenBeacon groups are on hold",
    },
  }[kind];
  const rendered = await renderEmailLayout({
    serverName,
    title: text.title,
    preview: text.preview,
    children: (
      <>
        <Text style={{ margin: "0 0 8px" }}>{text.intro}</Text>
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
        <EmailSubheading>Keep them sharing</EmailSubheading>
        <Text style={{ margin: 0 }}>{text.renew}</Text>
      </>
    ),
  });
  return {
    subject: text.subject,
    summary: {
      type: { ending: "seats:ending", reminder: "seats:ending-soon", ended: "seats:ended" }[kind],
    },
    ...rendered,
  };
};
