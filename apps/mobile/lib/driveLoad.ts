import { type DriveRecord, type EpochKeyMaterial, openDriveRecord } from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";

type DrivesPage = RouterOutputs["groupTracking"]["drives"];

export type LoadedDrive = Omit<DrivesPage["drives"][number], "ciphertext" | "nonce"> & {
  groupId: string;
  record: DriveRecord | null;
};

export const createDriveCache = () => {
  const groups = new Map<string, Map<string, LoadedDrive & { nonce: string }>>();
  const group = (groupId: string) => {
    const drives = groups.get(groupId) ?? new Map<string, LoadedDrive & { nonce: string }>();
    groups.set(groupId, drives);
    return drives;
  };
  return {
    find: (groupId: string, driveId: string) => groups.get(groupId)?.get(driveId),
    list: (groupId: string): LoadedDrive[] =>
      [...(groups.get(groupId)?.values() ?? [])].map(({ nonce: _nonce, ...drive }) => drive),
    replaceHours: (
      groupId: string,
      { fromHour, toHour }: { fromHour: number; toHour: number },
      drives: Array<LoadedDrive & { nonce: string }>,
    ) => {
      const cached = group(groupId);
      for (const [driveId, drive] of cached) {
        if (drive.startHour >= fromHour && drive.startHour < toHour) cached.delete(driveId);
      }
      for (const drive of drives) cached.set(drive.driveId, drive);
    },
    clear: () => groups.clear(),
  };
};

export const loadGroupDrives = async ({
  cache,
  epochKeyFor,
  fetchDrives,
  fromHour,
  groupId,
  toHour,
}: {
  cache: ReturnType<typeof createDriveCache>;
  epochKeyFor: (epochId: string) => Promise<EpochKeyMaterial | null>;
  fetchDrives: (input: RouterInputs["groupTracking"]["drives"]) => Promise<DrivesPage>;
  fromHour: number;
  groupId: string;
  toHour: number;
}) => {
  const listed: DrivesPage["drives"] = [];
  let cursor: DrivesPage["cursor"] = null;
  for (;;) {
    const page: DrivesPage = await fetchDrives({
      groupId,
      fromHour,
      toHour,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    listed.push(...page.drives);
    if (!page.hasMore || !page.cursor) break;
    cursor = page.cursor;
  }

  const keys = new Map<string, EpochKeyMaterial | null>();
  const loaded: Array<LoadedDrive & { nonce: string }> = [];
  for (const { ciphertext, ...drive } of listed) {
    const cached = cache.find(groupId, drive.driveId);
    if (
      cached?.record &&
      cached.nonce === drive.nonce &&
      cached.epochId === drive.epochId &&
      cached.startHour === drive.startHour
    ) {
      loaded.push({ ...cached, replacedAt: drive.replacedAt });
      continue;
    }
    if (!keys.has(drive.epochId)) keys.set(drive.epochId, await epochKeyFor(drive.epochId));
    const epochKey = keys.get(drive.epochId);
    let record: DriveRecord | null = null;
    if (epochKey) {
      try {
        record = openDriveRecord({
          epochId: drive.epochId,
          epochKey,
          groupId,
          sealed: {
            ciphertext,
            driveId: drive.driveId,
            nonce: drive.nonce,
            startHour: drive.startHour,
          },
          senderDeviceId: drive.senderDeviceId,
        });
      } catch {
        record = null;
      }
    }
    loaded.push({ ...drive, groupId, record });
  }
  cache.replaceHours(groupId, { fromHour, toHour }, loaded);
  return loaded
    .map(({ nonce: _nonce, ...drive }) => drive)
    .sort(
      (first, second) =>
        second.startHour - first.startHour ||
        (second.record?.start.time ?? 0) - (first.record?.start.time ?? 0),
    );
};
