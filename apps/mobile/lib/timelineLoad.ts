import {
  decodeTrackingPoint,
  decryptGroupPayload,
  type EpochKeyMaterial,
  PAYLOAD_ENCRYPTION_ALGORITHM,
  TRACKING_POINT_KIND,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import type { TimelineDay, TimelineDeviceData } from "./timelineTypes.ts";

type EpochWraps = RouterOutputs["groupEpoch"]["listEpochKeyWraps"];
type RangePage = RouterOutputs["groupTracking"]["historyRange"];

const HOUR_MS = 60 * 60_000;

export const loadTimelineDay = async ({
  chunkSize = 250,
  day,
  fetchRange,
  groupId,
  listEpochs,
  now,
  onProgress,
  signal,
  unwrapEpoch,
  yieldToUi,
}: {
  chunkSize?: number;
  day: TimelineDay;
  fetchRange: (input: RouterInputs["groupTracking"]["historyRange"]) => Promise<RangePage>;
  groupId: string;
  listEpochs: (cursor: number | null) => Promise<EpochWraps>;
  now: number;
  onProgress?: (progress: { decrypted: number; total: number }) => void;
  signal?: AbortSignal;
  unwrapEpoch: (epoch: EpochWraps["epochs"][number]) => Promise<EpochKeyMaterial | null>;
  yieldToUi: () => Promise<void>;
}): Promise<{ devices: TimelineDeviceData[]; joinStart: number | null }> => {
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new Error("Timeline load cancelled.");
  };
  const from = new Date(day.start - 3 * HOUR_MS);
  const to = new Date(Math.min(day.end + 24 * HOUR_MS, now));

  const streams = new Map<string, RangePage["streams"][number]>();
  const encrypted: RangePage["points"] = [];
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
    encrypted.push(...page.lookback, ...page.points);
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }

  const neededEpochs = new Set([...streams.values()].map((stream) => stream.epochId));
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

  const devices = new Map<string, TimelineDeviceData>();
  for (let index = 0; index < encrypted.length; index += chunkSize) {
    stopIfCancelled();
    for (const point of encrypted.slice(index, index + chunkSize)) {
      const stream = streams.get(point.streamId);
      if (!stream) continue;
      const deviceKey = JSON.stringify([stream.senderUserId, stream.senderDeviceId]);
      const device = devices.get(deviceKey) ?? {
        deviceId: stream.senderDeviceId,
        points: [],
        undecryptable: 0,
        userId: stream.senderUserId,
      };
      devices.set(deviceKey, device);
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
    onProgress?.({
      decrypted: Math.min(index + chunkSize, encrypted.length),
      total: encrypted.length,
    });
    await yieldToUi();
  }

  for (const device of devices.values()) {
    device.points.sort((a, b) => a.time - b.time || a.pointId.localeCompare(b.pointId));
  }
  return { devices: [...devices.values()], joinStart };
};
