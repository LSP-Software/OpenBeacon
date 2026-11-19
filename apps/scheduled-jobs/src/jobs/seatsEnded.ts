import { sendSeatsEndedNotices } from "@openbeacon/api/seatsEnded.ts";
import { emailEnabled, sendSeatsEndedEmail } from "@openbeacon/email";
import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const runSeatsEnded = async () =>
  sendSeatsEndedNotices({
    db: services.db,
    now: await getDatabaseTime(),
    sendEmail: emailEnabled
      ? ({ holds, ...email }) =>
          sendSeatsEndedEmail({
            ...email,
            holds: holds.map(({ groupId, groupName, memberName, deviceName }) => ({
              groupId,
              groupName,
              memberName,
              deviceName,
            })),
          })
      : null,
  });
