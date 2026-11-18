import { sendSeatGraceWarnings } from "@openbeacon/api/seatGraceWarnings.ts";
import { emailEnabled, sendSeatsEndingEmail } from "@openbeacon/email";
import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

export const runSeatGraceWarnings = async () =>
  sendSeatGraceWarnings({
    db: services.db,
    now: await getDatabaseTime(),
    sendEmail: emailEnabled
      ? ({ holds, ...email }) =>
          sendSeatsEndingEmail({
            ...email,
            holds: holds.map(({ groupName, memberName, deviceName }) => ({
              groupName,
              memberName,
              deviceName,
            })),
          })
      : null,
  });
