import type { CrashAlertMessage } from "@openbeacon/encryption";

export type CrashIncident = {
  key: string;
  userId: string;
  alertIds: string[];
  messageIds: string[];
  groupIds: string[];
  devices: string[];
  crash: CrashAlertMessage["crash"];
  placeLabel: string | null;
  sharingUntil: number | null;
  sentAt: number | null;
  lastNewsAt: number;
  ok: { at: number } | null;
};

export type CrashInbox = { incidents: CrashIncident[] };

type Words = {
  name: (userId: string) => string;
  speed: (metersPerSecond: number) => string;
  time: (ms: number) => string;
};

const MERGE_MS = 5 * 60_000;
const LATE_MS = 5 * 60_000;
const SHOWN_MS = 2 * 3_600_000;
const KEPT_MS = 24 * 3_600_000;

export const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

export const emptyCrashInbox: CrashInbox = { incidents: [] };

export const receiveCrashAlerts = (
  inbox: CrashInbox,
  alerts: readonly {
    deviceName: string;
    groupId: string;
    message: CrashAlertMessage;
    receivedAt: number;
    userId: string;
  }[],
) => {
  let incidents = inbox.incidents;
  const changed = new Map<string, "crash" | "ok">();
  for (const { deviceName, groupId, message, receivedAt, userId } of alerts) {
    const known = incidents.find((incident) => incident.messageIds.includes(message.messageId));
    if (known) {
      incidents = incidents.map((incident) =>
        incident === known
          ? { ...incident, groupIds: [...new Set([...incident.groupIds, groupId])] }
          : incident,
      );
      continue;
    }
    const match =
      incidents.find(
        (incident) => incident.userId === userId && incident.alertIds.includes(message.alertId),
      ) ??
      (message.type === "CRASH"
        ? incidents.find(
            (incident) =>
              incident.userId === userId &&
              Math.abs(incident.crash.time - message.crash.time) <= MERGE_MS,
          )
        : undefined);
    const isCrash = message.type === "CRASH";
    const base: CrashIncident = match ?? {
      key: `${userId}:${message.alertId}`,
      userId,
      alertIds: [],
      messageIds: [],
      groupIds: [],
      devices: [],
      crash: message.crash,
      placeLabel: message.placeLabel,
      sharingUntil: null,
      sentAt: null,
      lastNewsAt: receivedAt,
      ok: null,
    };
    const next: CrashIncident = {
      ...base,
      alertIds: [...new Set([...base.alertIds, message.alertId])],
      messageIds: [...base.messageIds, message.messageId],
      groupIds: [...new Set([...base.groupIds, groupId])],
      devices: isCrash ? [...new Set([...base.devices, deviceName])] : base.devices,
      placeLabel: base.placeLabel ?? message.placeLabel,
      sharingUntil: isCrash
        ? Math.max(base.sharingUntil ?? 0, message.sharingUntil)
        : base.sharingUntil,
      sentAt: isCrash ? (base.sentAt ?? receivedAt) : base.sentAt,
      lastNewsAt: Math.max(base.lastNewsAt, receivedAt),
      ok: message.okAt === null ? base.ok : { at: Math.max(base.ok?.at ?? 0, message.okAt) },
    };
    incidents = match
      ? incidents.map((incident) => (incident === match ? next : incident))
      : [...incidents, next];
    if (isCrash && base.devices.length === next.devices.length && match) continue;
    if (isCrash && next.ok) continue;
    if (!isCrash && base.ok) continue;
    changed.set(next.key, isCrash ? "crash" : "ok");
  }
  return {
    inbox: { incidents },
    notices: [...changed].flatMap(([key, kind]) => {
      const incident = incidents.find((item) => item.key === key);
      return incident ? [{ key: kind === "ok" ? `${key}:ok` : key, kind, incident }] : [];
    }),
  };
};

export const forgetOldCrashAlerts = (inbox: CrashInbox, now: number): CrashInbox => ({
  incidents: inbox.incidents.filter((incident) => now - incident.lastNewsAt < KEPT_MS),
});

export const activeCrashFor = (inbox: CrashInbox, userId: string, now: number) =>
  inbox.incidents
    .filter((incident) => incident.userId === userId && now - incident.lastNewsAt <= SHOWN_MS)
    .sort((a, b) => b.lastNewsAt - a.lastNewsAt)[0] ?? null;

export const isLateCrashAlert = (incident: CrashIncident) =>
  incident.sentAt !== null && incident.sentAt - incident.crash.time > LATE_MS;

const near = (incident: CrashIncident) =>
  incident.placeLabel ? ` near ${incident.placeLabel}` : "";

export const describeCrashNotice = (
  incident: CrashIncident,
  words: Words,
  kind: "crash" | "ok" = "crash",
) => {
  const name = words.name(incident.userId);
  const at = words.time(incident.crash.time);
  if (kind === "ok") {
    return { title: `${name} says they’re OK`, body: `After a possible crash at ${at}.` };
  }
  const speed = `${words.speed(incident.crash.speedBefore)} just before.`;
  if (isLateCrashAlert(incident) && incident.sentAt !== null) {
    const place = incident.placeLabel ? `Near ${incident.placeLabel}, ${speed}` : `${speed}`;
    return {
      title: `${name}: possible crash at ${at}`,
      body: `Sent at ${words.time(incident.sentAt)}, after ${incident.devices[0] ?? `${name}’s phone`} had no signal. ${place}`,
    };
  }
  const where = `At ${at}${near(incident)}, ${speed}`;
  return {
    title: `${name}: possible crash`,
    body:
      incident.devices.length > 1
        ? `${where} Sent by ${incident.devices.slice(0, -1).join(", ")} and ${incident.devices.at(-1)}.`
        : `${where} Tap to see where ${name} is now.`,
  };
};

export const crashHistoryItems = (
  alerts: readonly {
    deviceName: string;
    message: CrashAlertMessage;
    receivedAt: number;
    userId: string;
  }[],
  words: Words,
  deviceLabel: (userId: string, deviceName: string) => string,
) =>
  [...new Map(alerts.map((alert) => [alert.message.messageId, alert])).values()]
    .map(({ deviceName, message, receivedAt, userId }) => ({
      kind: "crash" as const,
      id: `crash:${message.messageId}`,
      at: new Date(receivedAt),
      ok: message.type === "OK",
      text:
        message.type === "OK"
          ? `${words.name(userId)} says they’re OK`
          : `${deviceLabel(userId, deviceName)} sent a Crash alert: possible crash at ${words.time(message.crash.time)}${
              message.placeLabel ? ` near ${message.placeLabel}` : ""
            }${receivedAt - message.crash.time > LATE_MS ? ` (arrived ${words.time(receivedAt)}, after no signal)` : ""}`,
    }))
    .sort((a, b) => b.at.getTime() - a.at.getTime());

export const crashFocusSpot = (incident: CrashIncident, person: { timestamp: string | null }) =>
  person.timestamp !== null && Date.parse(person.timestamp) >= incident.crash.time
    ? null
    : { latitude: incident.crash.latitude, longitude: incident.crash.longitude };
