import type { EpochKeyMaterial, TrackingPoint } from "@openbeacon/encryption";
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import type { RouterInputs, RouterOutputs } from "./api.ts";
import { metersBetween } from "./places.ts";
import { NO_LOCATION_AFTER_MS, SAME_STOP_METERS } from "./timeline.ts";
import { loadTimelineDay } from "./timelineLoad.ts";
import type { TimelineDay, TimelineDeviceData } from "./timelineTypes.ts";

type EpochWraps = RouterOutputs["groupEpoch"]["listEpochKeyWraps"];

type ExportPoint = TrackingPoint & { revisionPrefix: string };

type ExportDevice = { deviceId: string; name: string; points: ExportPoint[] };

const HOUR_MS = 60 * 60_000;
const WINDOW_HOURS = 24;
const RATE_LIMIT_TRIES = 3;
const RATE_LIMIT_WAIT_MS = 20_000;

export const historyExportWindows = (hours: readonly number[]): TimelineDay[] => {
  const windows: TimelineDay[] = [];
  let first: number | null = null;
  let last = 0;
  const close = () => {
    if (first === null) return;
    windows.push({
      end: (last + 1) * HOUR_MS,
      key: String(first),
      start: first * HOUR_MS,
    });
  };
  for (const hour of [...new Set(hours)].sort((a, b) => a - b)) {
    if (first === null || hour >= first + WINDOW_HOURS) {
      close();
      first = hour;
    }
    last = hour;
  }
  close();
  return windows;
};

export const loadOwnHistory = async ({
  deviceNames,
  fetchRange,
  groupIds,
  historyDays,
  listEpochs,
  onProgress,
  signal,
  unwrapEpoch,
  userId,
  wait,
  yieldToUi,
}: {
  deviceNames: ReadonlyMap<string, string>;
  fetchRange: (
    input: RouterInputs["groupTracking"]["historyRange"],
  ) => Promise<RouterOutputs["groupTracking"]["historyRange"]>;
  groupIds: readonly string[];
  historyDays: (groupId: string) => Promise<RouterOutputs["groupTracking"]["historyDays"]>;
  listEpochs: (groupId: string, cursor: number | null) => Promise<EpochWraps>;
  onProgress?: (progress: { done: number; total: number }) => void;
  signal: AbortSignal;
  unwrapEpoch: (epoch: EpochWraps["epochs"][number]) => Promise<EpochKeyMaterial | null>;
  userId: string;
  wait: (ms: number) => Promise<void>;
  yieldToUi: () => Promise<void>;
}): Promise<{
  devices: ExportDevice[];
  undecryptable: boolean;
  failedGroups: number;
}> => {
  const cancelled = () => new Error("History export cancelled.");
  if (signal.aborted) throw cancelled();
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(cancelled()), { once: true });
  });
  aborted.catch(() => {});

  const withRetries = async <T>(run: () => Promise<T>): Promise<T> => {
    for (let attempt = 1; ; attempt += 1) {
      const result = await tryCatch(run());
      if (result.error === null) return result.data;
      if (signal.aborted) throw cancelled();
      const rateLimited =
        result.error instanceof TRPCClientError && result.error.data?.code === "TOO_MANY_REQUESTS";
      if (!rateLimited || attempt >= RATE_LIMIT_TRIES) throw result.error;
      await Promise.race([wait(attempt * RATE_LIMIT_WAIT_MS), aborted]);
      if (signal.aborted) throw cancelled();
    }
  };

  const plans = await Promise.all(
    groupIds.map(async (groupId) => {
      const days = await tryCatch(withRetries(() => historyDays(groupId)));
      if (signal.aborted) throw cancelled();
      if (days.error !== null) return { groupId, windows: null };
      const hours = days.data.devices
        .filter((device) => device.senderUserId === userId)
        .flatMap((device) => device.hours.map(({ hour }) => hour));
      return { groupId, windows: historyExportWindows(hours) };
    }),
  );
  const total = plans.reduce((sum, plan) => sum + (plan.windows?.length ?? 0), 0);
  let done = 0;
  let failedGroups = plans.filter((plan) => plan.windows === null).length;
  onProgress?.({ done, total });

  const merged = new Map<string, Map<number, ExportPoint>>();
  let undecryptable = false;
  for (const { groupId, windows } of plans) {
    if (windows === null) continue;
    const epochPages = new Map<number | null, Promise<EpochWraps>>();
    const epochKeys = new Map<string, Promise<EpochKeyMaterial | null>>();
    const groupDevices: TimelineDeviceData[] = [];
    let failed = false;
    for (const [index, day] of windows.entries()) {
      if (signal.aborted) throw cancelled();
      const loaded = await tryCatch(
        withRetries(() =>
          loadTimelineDay({
            day,
            fetchRange,
            groupId,
            listEpochs: (cursor) => {
              const page = epochPages.get(cursor) ?? listEpochs(groupId, cursor);
              epochPages.set(cursor, page);
              page.catch(() => epochPages.delete(cursor));
              return page;
            },
            signal,
            unwrapEpoch: (epoch) => {
              const key = epochKeys.get(epoch.epochId) ?? unwrapEpoch(epoch);
              epochKeys.set(epoch.epochId, key);
              key.catch(() => epochKeys.delete(epoch.epochId));
              return key;
            },
            userIds: [userId],
            yieldToUi,
          }),
        ),
      );
      if (signal.aborted) throw cancelled();
      if (loaded.error !== null) {
        failed = true;
        done += windows.length - index;
        onProgress?.({ done, total });
        break;
      }
      groupDevices.push(...loaded.data.devices);
      done += 1;
      onProgress?.({ done, total });
    }
    if (failed) {
      failedGroups += 1;
      continue;
    }
    for (const device of groupDevices) {
      if (!deviceNames.has(device.deviceId)) continue;
      if (device.undecryptable > 0) undecryptable = true;
      const points = merged.get(device.deviceId) ?? new Map<number, ExportPoint>();
      merged.set(device.deviceId, points);
      for (const { pointId: _pointId, streamId: _streamId, ...point } of device.points) {
        const existing = points.get(point.time);
        if (!existing || (point.stayUntil ?? 0) > (existing.stayUntil ?? 0)) {
          points.set(point.time, point);
        }
      }
    }
  }

  const devices = [...merged].flatMap(([deviceId, points]) => {
    const name = deviceNames.get(deviceId);
    if (name === undefined || points.size === 0) return [];
    return [{ deviceId, name, points: mergeOverlappingStays(points.values()) }];
  });
  devices.sort((a, b) => a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId));
  return { devices, failedGroups, undecryptable };
};

const mergeOverlappingStays = (points: Iterable<ExportPoint>) => {
  const kept: ExportPoint[] = [];
  let lastStayIndex = -1;
  for (const point of [...points].sort((a, b) => a.time - b.time)) {
    const lastStay = kept[lastStayIndex];
    if (
      point.stayUntil !== null &&
      lastStay?.stayUntil != null &&
      point.time <= lastStay.stayUntil &&
      metersBetween(lastStay, point) <= SAME_STOP_METERS
    ) {
      kept[lastStayIndex] = {
        ...lastStay,
        stayUntil: Math.max(lastStay.stayUntil, point.stayUntil),
      };
      continue;
    }
    if (point.stayUntil !== null) lastStayIndex = kept.length;
    kept.push(point);
  }
  return kept;
};

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const isoTime = (time: number) => new Date(time).toISOString();

export const buildHistoryGpx = ({
  devices,
  exportedAt,
}: {
  devices: readonly ExportDevice[];
  exportedAt: number;
}) => {
  const trackPoint = (point: ExportPoint, time: number) =>
    `      <trkpt lat="${point.latitude.toFixed(7)}" lon="${point.longitude.toFixed(7)}"><time>${isoTime(time)}</time></trkpt>`;
  const tracks = devices.map(({ name, points }) => {
    const segments: string[][] = [];
    let segment: string[] = [];
    points.forEach((point, index) => {
      const next = points[index + 1];
      const coveredUntil = Math.max(
        point.time,
        Math.min(point.stayUntil ?? point.time, next?.time ?? Infinity),
      );
      segment.push(trackPoint(point, point.time));
      if (coveredUntil > point.time) segment.push(trackPoint(point, coveredUntil));
      if (
        !next ||
        next.revisionPrefix !== point.revisionPrefix ||
        next.time - coveredUntil > NO_LOCATION_AFTER_MS
      ) {
        segments.push(segment);
        segment = [];
      }
    });
    return [
      "  <trk>",
      `    <name>${escapeXml(name)}</name>`,
      ...segments.flatMap((points) => ["    <trkseg>", ...points, "    </trkseg>"]),
      "  </trk>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="OpenBeacon" xmlns="http://www.topografix.com/GPX/1/1">',
    "  <metadata>",
    "    <name>OpenBeacon location history</name>",
    `    <time>${isoTime(exportedAt)}</time>`,
    "  </metadata>",
    ...tracks,
    "</gpx>",
    "",
  ].join("\n");
};

export const buildHistoryJson = ({
  devices,
  exportedAt,
}: {
  devices: readonly ExportDevice[];
  exportedAt: number;
}) =>
  `${JSON.stringify({
    format: "openbeacon-location-history",
    version: 1,
    exportedAt: isoTime(exportedAt),
    devices: devices.map(({ deviceId, name, points }) => ({
      id: deviceId,
      name,
      points: points.map((point) => ({
        time: isoTime(point.time),
        latitude: point.latitude,
        longitude: point.longitude,
        accuracyMetres: point.accuracy,
        speedMetresPerSecond: point.speed,
        stayedUntil: point.stayUntil === null ? null : isoTime(point.stayUntil),
        batteryPercent: point.battery.level,
        charging: point.battery.charging,
      })),
    })),
  })}\n`;
