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
    optional,
    ...message
  }: EmailMessage & { userId?: string; optional: boolean }): Promise<
    { sent: true } | { sent: false; reason: "disabled" | "capped" | "unavailable" }
  > => {
    if (!dependencies) return { sent: false, reason: "disabled" };
    if (userId) {
      const rateLimit = await dependencies.rateLimits.consume(
        {
          namespace: "email",
          identifier: { type: "userId", value: userId },
          limit: 20,
          windowMs: 60 * 60 * 1000,
        },
        { whenUnavailable: optional ? "deny" : "allow" },
      );
      if (!rateLimit.allowed && optional)
        return { sent: false, reason: rateLimit.unavailable ? "unavailable" : "capped" };
    }
    await dependencies.transport.send(message);
    return { sent: true };
  };
