import { openDriveRecord } from "@openbeacon/encryption";
import { alertsCursorSchema } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import z from "zod";
import { type AccountRound, isRoundCurrent } from "./accountSession.ts";
import type { RouterOutputs } from "./api.ts";
import { driveAlertsToShow } from "./driveAlerts.ts";
import { getBaseUrl } from "./currentServer.ts";
import { resolveEpochKey } from "./epochKeys.ts";
import { nicknamesByGroup } from "./nicknamesByGroup.ts";
import { showEventNotice } from "./notifications.ts";
import { parseJson } from "./parseJson.ts";
import { storage } from "./storage.ts";
import { defaultUnits, parseDistancePreference, parseSpeedPreference } from "./units.ts";

const SHOWN_KEPT_MS = 2 * 3_600_000;

const storageKey = (userId: string, name: string) =>
  `driveAlerts.${name}.${JSON.stringify([getBaseUrl(), userId])}`;

const shownSchema = z.record(z.string(), z.number());

export const getDriveAlertsCursor = (userId: string) => {
  const parsed = alertsCursorSchema.safeParse(storage.getString(storageKey(userId, "cursor")));
  return parsed.success ? parsed.data : null;
};

const units = () => {
  const locale = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale);
  const region = defaultUnits({ measurementSystem: null, regionCode: locale.region ?? null });
  const storedSpeed = storage.getString("units.speed");
  const speed = parseSpeedPreference(storedSpeed);
  const distance = parseDistancePreference(storage.getString("units.distance"), storedSpeed);
  return {
    speed: speed === "auto" ? region.speed : speed,
    distance: distance === "auto" ? region.distance : distance,
  };
};

export const timelineDriveLink = ({
  driveId,
  groupId,
  passenger = false,
}: {
  driveId: string;
  groupId: string;
  passenger?: boolean;
}) => ({
  href: {
    pathname: "/timeline",
    params: { groupId, driveId, ...(passenger ? { passenger: "1" } : {}) },
  } as const,
  url: `openbeacon:///timeline?groupId=${encodeURIComponent(groupId)}&driveId=${encodeURIComponent(driveId)}${passenger ? "&passenger=1" : ""}`,
});

export const applyDriveAlerts = async ({
  driveAlerts,
  groups,
  round,
}: {
  driveAlerts: NonNullable<RouterOutputs["groupTracking"]["uploadBatch"]["driveAlerts"]>;
  groups: () => Promise<RouterOutputs["groupMembership"]["list"]>;
  round: AccountRound;
}) => {
  const { userId } = round;
  const copies = [];
  for (const alert of driveAlerts.alerts) {
    const epochKey = await tryCatch(
      resolveEpochKey({ epochId: alert.epochId, groupId: alert.groupId }),
    );
    if (!epochKey.data) continue;
    const key = epochKey.data;
    const record = await tryCatch(
      Promise.resolve().then(() =>
        openDriveRecord({
          epochId: alert.epochId,
          epochKey: key,
          groupId: alert.groupId,
          sealed: alert,
          senderDeviceId: alert.senderDeviceId,
        }),
      ),
    );
    if (record.data) copies.push({ ...alert, record: record.data });
  }
  if (!isRoundCurrent(round)) return;
  const now = Date.now();
  const stored = shownSchema
    .catch({})
    .parse(parseJson(storage.getString(storageKey(userId, "shown")) ?? "{}"));
  const shown = Object.fromEntries(
    Object.entries(stored).filter(([, at]) => now - at < SHOWN_KEPT_MS),
  );
  const groupList = copies.length > 0 ? ((await tryCatch(groups())).data ?? []) : [];
  const nicknamesFor = nicknamesByGroup(userId);
  const names = new Map<string, string>();
  for (const copy of copies) {
    const member = groupList
      .find(({ id }) => id === copy.groupId)
      ?.members.find((item) => item.userId === copy.senderUserId);
    if (!member) continue;
    const nickname = (await nicknamesFor(copy.groupId))[member.id]?.name;
    names.set(`${copy.groupId}|${copy.senderUserId}`, nickname ?? member.name);
  }
  const alerts = driveAlertsToShow({
    copies,
    nameOf: (senderUserId, groupId) => names.get(`${groupId}|${senderUserId}`) ?? "Someone",
    now,
    shown: new Set(Object.keys(shown)),
    units: units(),
  });
  for (const alert of alerts) shown[alert.driveId] = now;
  if (!isRoundCurrent(round)) return;
  storage.set(storageKey(userId, "shown"), JSON.stringify(shown));
  storage.set(storageKey(userId, "cursor"), driveAlerts.cursor);
  for (const alert of alerts) {
    await showEventNotice({
      body: alert.body,
      groupName: groupList.find(({ id }) => id === alert.groupId)?.name ?? null,
      key: `drive:${alert.driveId}`,
      kind: "driveAlert",
      link: timelineDriveLink(alert),
      round,
      title: alert.title,
    });
  }
};
