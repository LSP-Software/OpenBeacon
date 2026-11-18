import type { OpenBeaconCache } from "@openbeacon/cache";
import type { EmailMessage, EmailTransport } from "./types.ts";

export const createSendEmail =
  (
    dependencies: {
      transport: EmailTransport;
      rateLimits: Pick<OpenBeaconCache["rateLimits"], "consume">;
    } | null,
  ) =>
  async ({
    userId,
    cap,
    ...message
  }: EmailMessage & { userId?: string; cap: "alerts" | "notices" | null }): Promise<
    { sent: true } | { sent: false; reason: "disabled" | "capped" | "unavailable" }
  > => {
    if (!dependencies) return { sent: false, reason: "disabled" };
    if (userId && cap) {
      const rateLimit = await dependencies.rateLimits.consume(
        {
          namespace: `email.${cap}`,
          identifier: { type: "userId", value: userId },
          limit: 20,
          windowMs: 60 * 60 * 1000,
        },
        { whenUnavailable: "deny" },
      );
      if (!rateLimit.allowed)
        return { sent: false, reason: rateLimit.unavailable ? "unavailable" : "capped" };
    }
    await dependencies.transport.send(message);
    return { sent: true };
  };
