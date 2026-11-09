import { OpenBeaconCache, redisUrlSchema } from "@openbeacon/cache";
import { tryCatch } from "@openbeacon/shared";
import { loadEmailSettings } from "./config.ts";
import { renderEmailLayout } from "./layout.tsx";
import { createSendEmail } from "./sender.ts";
import { createEmailTransport } from "./transport.ts";

const { serverName, config } = loadEmailSettings();
const transport = config.transport === "none" ? null : createEmailTransport(config);

export const emailEnabled = transport !== null;

export const checkEmail = async () => {
  if (!transport) return;
  const result = await tryCatch(transport.verify());
  if (!result.error) return;
  console.error(`  Email: ${result.error.message}`);
  throw result.error;
};

export type { EmailMessage } from "./types.ts";

export const renderEmail = (email: Omit<Parameters<typeof renderEmailLayout>[0], "serverName">) =>
  renderEmailLayout({ ...email, serverName });

export const sendEmail = createSendEmail(
  transport
    ? {
        transport,
        rateLimits: new OpenBeaconCache({
          redisUrl: redisUrlSchema.parse(process.env["REDIS_URL"]),
        }).rateLimits,
      }
    : null,
);
