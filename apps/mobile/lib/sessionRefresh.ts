import { tryCatch } from "@openbeacon/shared";
import { authClient } from "./auth-client.ts";
import { storage } from "./storage.ts";

const refreshedAtKey = "session.refreshedAt";

export const refreshSessionIfDue = async (now = Date.now()) => {
  const refreshedAt = Number(storage.getString(refreshedAtKey));
  if (now >= refreshedAt && now - refreshedAt < 12 * 60 * 60_000) return;
  const result = await tryCatch(authClient.getSession());
  if (!result.error && !result.data.error) storage.set(refreshedAtKey, String(now));
};
