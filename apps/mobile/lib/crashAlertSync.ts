import { type CrashAlertMessage, openCrashAlert } from "@openbeacon/encryption";
import { alertsCursorSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import z from "zod";
import type { QueuedCrashAlert } from "../modules/openbeacon-tracking/index.ts";
import { type AccountRound, accountRequest, isRoundCurrent } from "./accountSession.ts";
import { type RouterOutputs, trpcClient } from "./api.ts";
import {
  type CrashInbox,
  activeCrashFor,
  describeCrashNotice,
  emptyCrashInbox,
  forgetOldCrashAlerts,
  formatClock,
  receiveCrashAlerts,
} from "./crashAlertInbox.ts";
import { getBaseUrl } from "./currentServer.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { parseJson } from "./parseJson.ts";
import { storage } from "./storage.ts";
import { loadTrackingModule } from "./trackingModule.ts";
import { storedUnits } from "./storedUnits.ts";
import { formatSpeed } from "./units.ts";

type ReceivedCrashAlerts = NonNullable<
  RouterOutputs["groupTracking"]["uploadBatch"]["crashAlerts"]
>;

const incidentSchema = z.object({
  key: z.string(),
  userId: z.string(),
  alertIds: z.array(z.string()),
  messageIds: z.array(z.string()),
  groupIds: z.array(z.string()),
  devices: z.array(z.string()),
  crash: z.object({
    time: z.number(),
    latitude: z.number(),
    longitude: z.number(),
    speedBefore: z.number(),
  }),
  placeLabel: z.string().nullable(),
  sharingUntil: z.number().nullable(),
  sentAt: z.number().nullable(),
  lastNewsAt: z.number(),
  ok: z.object({ at: z.number() }).nullable(),
});
const inboxSchema = z.object({ incidents: z.array(incidentSchema) });

const storageKey = (userId: string, name: string) =>
  `crashAlerts.${name}.${JSON.stringify([getBaseUrl(), userId])}`;

const listeners = new Set<() => void>();

const readInbox = (userId: string): CrashInbox => {
  const raw = storage.getString(storageKey(userId, "inbox"));
  const parsed = inboxSchema.safeParse(raw === undefined ? undefined : parseJson(raw));
  return parsed.success ? parsed.data : emptyCrashInbox;
};

export const getCrashAlertsCursor = (userId: string) => {
  const parsed = alertsCursorSchema.safeParse(storage.getString(storageKey(userId, "cursor")));
  return parsed.success ? parsed.data : null;
};

export const crashWords = (name: (userId: string) => string) => ({
  name,
  speed: (metersPerSecond: number) => formatSpeed(metersPerSecond, storedUnits().speed),
  time: formatClock,
});

export const openCrashAlerts = async (alerts: readonly ReceivedCrashAlerts["alerts"][number][]) => {
  const keys = new Map<string, ReturnType<typeof resolveEpochKey>>();
  const opened: {
    deviceName: string;
    groupId: string;
    message: CrashAlertMessage;
    receivedAt: number;
    userId: string;
  }[] = [];
  for (const alert of alerts) {
    const cacheKey = `${alert.groupId}|${alert.epochId}`;
    const pending =
      keys.get(cacheKey) ?? resolveEpochKey({ epochId: alert.epochId, groupId: alert.groupId });
    keys.set(cacheKey, pending);
    const epochKey = await tryCatch(pending);
    if (!epochKey.data) continue;
    const key = epochKey.data;
    const message = await tryCatch(
      Promise.resolve().then(() =>
        openCrashAlert({
          epochId: alert.epochId,
          epochKey: key,
          groupId: alert.groupId,
          sealed: alert,
          senderDeviceId: alert.senderDeviceId,
        }),
      ),
    );
    if (message.error) continue;
    opened.push({
      deviceName: alert.deviceName,
      groupId: alert.groupId,
      message: message.data,
      receivedAt: new Date(alert.receivedAt).getTime(),
      userId: alert.senderUserId,
    });
  }
  return opened;
};

export const applyCrashAlerts = async ({
  crashAlerts,
  groups,
  round,
}: {
  crashAlerts: ReceivedCrashAlerts;
  groups: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  round: AccountRound;
}) => {
  const { userId } = round;
  const opened = await openCrashAlerts(crashAlerts.alerts);
  if (!isRoundCurrent(round)) return;
  const { inbox, notices } = receiveCrashAlerts(
    forgetOldCrashAlerts(readInbox(userId), Date.now()),
    opened,
  );
  storage.set(storageKey(userId, "inbox"), JSON.stringify(inbox));
  storage.set(storageKey(userId, "cursor"), crashAlerts.cursor);
  for (const listener of listeners) listener();
  if (!crashAlerts.notify || notices.length === 0) return;
  const groupList = (await tryCatch(groups())).data ?? [];
  const nicknamesFor = nicknamesByGroup(userId);
  const names = new Map<string, string>();
  for (const { incident } of notices) {
    for (const groupId of incident.groupIds) {
      const member = groupList
        .find(({ id }) => id === groupId)
        ?.members.find((item) => item.userId === incident.userId);
      if (!member) continue;
      const nickname = (await nicknamesFor(groupId))[member.id]?.name;
      names.set(incident.userId, nickname ?? member.name);
      break;
    }
  }
  const trackingModule = await loadTrackingModule();
  if (!trackingModule || !isRoundCurrent(round)) return;
  const words = crashWords((id) => names.get(id) ?? "Someone");
  for (const notice of notices) {
    const text = describeCrashNotice(notice.incident, words, notice.kind);
    await tryCatch(
      Promise.resolve().then(() =>
        trackingModule.showCrashAlertNotice(
          notice.kind,
          notice.key,
          text.title,
          text.body,
          `openbeacon:///map?crashUserId=${encodeURIComponent(notice.incident.userId)}`,
        ),
      ),
    );
  }
};

export const sendQueuedCrashAlerts = async ({
  deviceId,
  round,
}: {
  deviceId: string;
  round: AccountRound;
}) => {
  const trackingModule = await loadTrackingModule();
  if (!trackingModule) return;
  const queued = (await tryCatch(trackingModule.listQueuedCrashAlerts())).data ?? [];
  const mine = queued.filter((alert) => alert.senderDeviceId === deviceId);
  const pair = ({ groupId, messageId }: Pick<QueuedCrashAlert, "groupId" | "messageId">) => ({
    groupId,
    messageId,
  });
  for (let start = 0; start < mine.length; start += 20) {
    const copies = mine.slice(start, start + 20);
    const sent = await tryCatch(
      trpcClient.crashAlerts.send.mutate(
        {
          copies: copies.map(({ ciphertext, epochId, groupId, messageId, nonce }) => ({
            ciphertext,
            epochId,
            groupId,
            messageId,
            nonce,
          })),
        },
        accountRequest(round),
      ),
    );
    if (sent.error) return;
    const { accepted, discarded, duplicates, expired, receivedAt } = sent.data;
    await trackingModule.markCrashAlertsSent(
      [...accepted, ...duplicates].map(pair),
      new Date(receivedAt).getTime(),
    );
    if (discarded.length + expired.length > 0) {
      await trackingModule.dropCrashAlerts([...discarded, ...expired].map(pair));
    }
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useActiveCrash = (viewerId: string | undefined, personId: string | null) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const raw = useSyncExternalStore(subscribe, () =>
    viewerId ? (storage.getString(storageKey(viewerId, "inbox")) ?? null) : null,
  );
  if (!viewerId || !personId || raw === null) return null;
  return activeCrashFor(readInbox(viewerId), personId, now);
};

export const useGroupCrashAlerts = ({
  enabled,
  groupId,
  userId,
}: {
  enabled: boolean;
  groupId: string;
  userId: string | undefined;
}) =>
  useQuery({
    queryKey: ["groupCrashAlerts", groupId, userId],
    queryFn: async () =>
      openCrashAlerts((await trpcClient.crashAlerts.group.query({ groupId })).alerts),
    enabled: enabled && userId !== undefined,
  }).data ?? [];
