import {
  decodeTrackingPoint,
  decryptGroupPayload,
  type EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import type { TimelineDay, TimelineDecryptProgress, TimelineDeviceData } from "./timelineTypes.ts";

type EpochWraps = RouterOutputs["groupEpoch"]["listEpochKeyWraps"];
type RangePage = RouterOutputs["groupTracking"]["historyRange"];

const HOUR_MS = 60 * 60_000;

export const timelineFetchWindow = (day: TimelineDay, now: number) => ({
  from: day.start - 3 * HOUR_MS,
  to: Math.min(day.end + 24 * HOUR_MS, now),
});

export const loadTimelineDay = async ({
  chunkSize = 250,
  day,
  fetchRange,
  groupId,
  listEpochs,
  now,
  onPersonReady,
  onProgress,
  signal,
  unwrapEpoch,
  userIds,
  yieldToUi,
}: {
  chunkSize?: number;
  day: TimelineDay;
  fetchRange: (input: RouterInputs["groupTracking"]["historyRange"]) => Promise<RangePage>;
  groupId: string;
  listEpochs: (cursor: number | null) => Promise<EpochWraps>;
  now: number;
  onPersonReady?: (ready: {
    devices: TimelineDeviceData[];
    joinStart: number | null;
    userId: string;
  }) => void;
  onProgress?: (people: TimelineDecryptProgress[]) => void;
  signal?: AbortSignal;
  unwrapEpoch: (epoch: EpochWraps["epochs"][number]) => Promise<EpochKeyMaterial | null>;
  userIds: readonly string[];
  yieldToUi: () => Promise<void>;
}): Promise<{ devices: TimelineDeviceData[]; joinStart: number | null }> => {
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new Error("Timeline load cancelled.");
  };
  const range = timelineFetchWindow(day, now);
  const from = new Date(range.from);
  const to = new Date(range.to);

  const streams = new Map<string, RangePage["streams"][number]>();
  const encrypted: RangePage["points"] = [];
  const seen = new Set<string>();
  let cursor: RangePage["cursor"] = null;
  while (from < to) {
    stopIfCancelled();
    const page: RangePage = await fetchRange({
      cursor: cursor ?? undefined,
      from,
      groupId,
      limit: 2_000,
      to,
    });
    for (const stream of page.streams) streams.set(stream.id, stream);
    for (const point of [...page.lookback, ...page.points]) {
      const key = `${point.streamId}:${point.pointId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      encrypted.push(point);
    }
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }

  const wanted = new Set(userIds);
  const byPerson = new Map<string, RangePage["points"]>();
  for (const point of encrypted) {
    const userId = streams.get(point.streamId)?.senderUserId;
    if (userId === undefined || !wanted.has(userId)) continue;
    const points = byPerson.get(userId) ?? [];
    points.push(point);
    byPerson.set(userId, points);
  }
  const neededEpochs = new Set(
    [...streams.values()]
      .filter((stream) => wanted.has(stream.senderUserId))
      .map((stream) => stream.epochId),
  );
  const epochKeys = new Map<string, EpochKeyMaterial>();
  let joinStart: number | null = null;
  let epochCursor: number | null = null;
  for (;;) {
    stopIfCancelled();
    const page = await listEpochs(epochCursor);
    for (const epoch of page.epochs) {
      if (!neededEpochs.delete(epoch.epochId)) continue;
      const epochKey = await unwrapEpoch(epoch);
      if (epochKey) epochKeys.set(epoch.epochId, epochKey);
    }
    const oldest = page.epochs.at(-1);
    if (page.nextCursor === null) {
      joinStart = oldest ? oldest.createdAt.getTime() : null;
      break;
    }
    if (neededEpochs.size === 0 && oldest && oldest.createdAt.getTime() <= day.start) break;
    epochCursor = page.nextCursor;
  }

  const progress: TimelineDecryptProgress[] = [...new Set(userIds)].flatMap((userId) => {
    const total = byPerson.get(userId)?.length ?? 0;
    return total > 0 ? [{ decrypted: 0, done: false, total, userId }] : [];
  });
  stopIfCancelled();
  onProgress?.(progress.map((person) => ({ ...person })));

  const ready: TimelineDeviceData[] = [];
  for (const person of progress) {
    const points = byPerson.get(person.userId) ?? [];
    const devices = new Map<string, TimelineDeviceData>();
    for (let index = 0; index < points.length; index += chunkSize) {
      stopIfCancelled();
      for (const point of points.slice(index, index + chunkSize)) {
        const stream = streams.get(point.streamId);
        if (!stream) continue;
        const device = devices.get(stream.senderDeviceId) ?? {
          deviceId: stream.senderDeviceId,
          points: [],
          undecryptable: 0,
          userId: stream.senderUserId,
        };
        devices.set(stream.senderDeviceId, device);
        const epochKey = epochKeys.get(stream.epochId);
        if (!epochKey) {
          device.undecryptable += 1;
          continue;
        }
        try {
          const metadata = {
            epochId: stream.epochId,
            groupId,
            kind: TRACKING_POINT_KIND,
            senderDeviceId: stream.senderDeviceId,
          };
          const decrypted = decryptGroupPayload({
            encryptedPayload: {
              ...metadata,
              algorithm: PAYLOAD_ENCRYPTION_ALGORITHM,
              ciphertext: point.ciphertext,
              createdAt: point.receivedAt,
              nonce: point.nonce,
            },
            epochKey,
            expectedMetadata: metadata,
          });
          device.points.push({
            ...decodeTrackingPoint(decrypted.bytes.expose()),
            pointId: point.pointId,
            revisionPrefix: stream.revisionPrefix,
            streamId: stream.id,
          });
        } catch {
          device.undecryptable += 1;
        }
      }
      person.decrypted = Math.min(index + chunkSize, points.length);
      person.done = person.decrypted === points.length;
      if (person.done) {
        for (const device of devices.values()) {
          device.points.sort((a, b) => a.time - b.time || a.pointId.localeCompare(b.pointId));
        }
      }
      stopIfCancelled();
      onProgress?.(progress.map((item) => ({ ...item })));
      if (person.done) {
        ready.push(...devices.values());
        onPersonReady?.({ devices: [...devices.values()], joinStart, userId: person.userId });
      }
      await yieldToUi();
    }
  }

  stopIfCancelled();
  return { devices: ready, joinStart };
};
