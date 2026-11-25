import {
  type DriveRecord,
  type EpochKeyMaterial,
  openDriveRecord,
  sealDriveRecord,
} from "@openbeacon/encryption";
import type { RouterInputs, RouterOutputs } from "./api.ts";

type DrivesPage = RouterOutputs["groupTracking"]["drives"];

export const drivingAgain = (full: DriveRecord) => (current: DriveRecord) => {
  if (full.driveId !== current.driveId) throw new Error("This isn't the same drive.");
  return { ...full, tellGroup: current.tellGroup };
};

export const rewriteDriveCopies = async ({
  driveId,
  epochKeyFor,
  fetchDrives,
  groupIds,
  replace,
  rewrite,
  selfUserId,
  startHour,
}: {
  driveId: string;
  epochKeyFor: (groupId: string, epochId: string) => Promise<EpochKeyMaterial | null>;
  fetchDrives: (input: RouterInputs["groupTracking"]["drives"]) => Promise<DrivesPage>;
  groupIds: readonly string[];
  replace: (input: RouterInputs["drives"]["replace"]) => Promise<unknown>;
  rewrite: (current: DriveRecord) => DriveRecord;
  selfUserId: string;
  startHour: number;
}) => {
  const copies: RouterInputs["drives"]["replace"]["copies"] = [];
  for (const groupId of groupIds) {
    let cursor: DrivesPage["cursor"] = null;
    let found: DrivesPage["drives"][number] | undefined;
    do {
      const page: DrivesPage = await fetchDrives({
        groupId,
        fromHour: startHour,
        toHour: startHour + 1,
        limit: 500,
        ...(cursor ? { cursor } : {}),
      });
      found = page.drives.find(
        (drive) => drive.driveId === driveId && drive.senderUserId === selfUserId,
      );
      cursor = page.hasMore ? page.cursor : null;
    } while (!found && cursor);
    if (!found) continue;
    const epochKey = await epochKeyFor(groupId, found.epochId);
    if (!epochKey) throw new Error("A copy of this drive can't be read here.");
    const current = openDriveRecord({
      epochId: found.epochId,
      epochKey,
      groupId,
      sealed: found,
      senderDeviceId: found.senderDeviceId,
    });
    const sealed = sealDriveRecord({
      epochId: found.epochId,
      epochKey,
      groupId,
      record: rewrite(current),
      senderDeviceId: found.senderDeviceId,
    });
    copies.push({
      ciphertext: sealed.ciphertext,
      groupId,
      nonce: sealed.nonce,
    });
  }
  if (copies.length === 0) throw new Error("This drive is no longer stored.");
  await replace({ copies, driveId });
};
