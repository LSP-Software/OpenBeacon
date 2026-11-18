import { sharedCache } from "@openbeacon/cache";
import { tryCatch } from "@openbeacon/shared";
import { renderAccountExistsEmail } from "./accountExistsEmail.tsx";
import { renderCodeEmail } from "./codeEmail.tsx";
import { loadEmailSettings } from "./config.ts";
import { renderGoogleSignInEmail } from "./googleSignInEmail.tsx";
import { createSendSecurityAlertEmail } from "./securityAlertEmail.tsx";
import { createSendEmail } from "./sender.ts";
import { createEmailTransport } from "./transport.ts";
import type { EmailCodePurpose } from "./types.ts";

const { serverName, config } = loadEmailSettings();
const transport = config.transport === "none" ? null : createEmailTransport(config);

export const emailEnabled = transport !== null;

export { emailUnreachableCode } from "./transport.ts";

export const checkEmail = async () => {
  if (!transport) return;
  const result = await tryCatch(transport.verify());
  if (!result.error) return;
  console.error(`  Email: ${result.error.message}`);
  throw result.error;
};

export {
  type EmailCodePurpose,
  type AlertDevice,
  type EmailMessage,
  type SecurityAlert,
  securityAlertSettings,
  type TurnedOffNotification,
} from "./types.ts";

export const sendEmail = createSendEmail(
  transport
    ? {
        transport,
        rateLimits: sharedCache().rateLimits,
      }
    : null,
);

export const sendCodeEmail = async ({
  to,
  purpose,
  code,
  userId,
}: {
  to: string;
  purpose: EmailCodePurpose;
  code: string;
  userId?: string;
}) =>
  sendEmail({
    to,
    ...(await renderCodeEmail({ purpose, code, serverName })),
    ...(userId ? { userId } : {}),
    cap: null,
  });

export const sendAccountExistsEmail = async ({
  to,
  userId,
  hasPassword,
}: {
  to: string;
  userId: string;
  hasPassword: boolean;
}) =>
  sendEmail({
    to,
    ...(await renderAccountExistsEmail({ hasPassword, serverName })),
    userId,
    cap: "notices",
  });

export const sendGoogleSignInEmail = async ({ to, userId }: { to: string; userId: string }) =>
  sendEmail({
    to,
    ...(await renderGoogleSignInEmail({ serverName })),
    userId,
    cap: "notices",
  });

export const sendSecurityAlertEmail = createSendSecurityAlertEmail({ sendEmail, serverName });
