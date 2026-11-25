import { alertsCursorSchema } from "@openbeacon/schemas";
import { getBaseUrl } from "./currentServer.ts";
import { storage } from "./storage.ts";

export const alertStorageKey = (
  kind: "crashAlerts" | "driveAlerts",
  userId: string,
  name: string,
) => `${kind}.${name}.${JSON.stringify([getBaseUrl(), userId])}`;

export const readAlertsCursor = (kind: "crashAlerts" | "driveAlerts", userId: string) => {
  const parsed = alertsCursorSchema.safeParse(
    storage.getString(alertStorageKey(kind, userId, "cursor")),
  );
  return parsed.success ? parsed.data : null;
};
