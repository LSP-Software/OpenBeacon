import { z } from "zod";

export const MAP_TILES_MANIFEST_KEY = "pmtiles-manifest.json";
export const ARCHIVE_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const SLOT_REUSE_MARGIN_MS = 24 * 60 * 60 * 1000;

const slotSchema = z.enum(["a", "b"]);

const archiveSchema = z
  .object({
    key: z.string().min(1),
    build: z.string().regex(/^\d{8}$/),
    size: z.number().int().positive(),
    schemaVersion: z.string().min(1),
    publishedAt: z.iso.datetime(),
    servedUntil: z.iso.datetime().optional(),
  })
  .loose();

export const mapTilesManifestSchema = z
  .object({
    current: slotSchema,
    slots: z.object({ a: archiveSchema.nullable(), b: archiveSchema.nullable() }),
    rejectedBuild: z
      .string()
      .regex(/^\d{8}$/)
      .optional(),
  })
  .loose()
  .refine((manifest) => manifest.slots[manifest.current] !== null, {
    message: "The current slot must hold an archive",
  });

export type MapTilesSlot = z.infer<typeof slotSchema>;
export type MapTilesArchive = z.infer<typeof archiveSchema>;
export type MapTilesManifest = z.infer<typeof mapTilesManifestSchema>;

export const getSlotKey = (slot: MapTilesSlot) => `planet-${slot}.pmtiles`;

export const getOtherSlot = (slot: MapTilesSlot): MapTilesSlot => (slot === "a" ? "b" : "a");

export const getArchiveId = ({ archive, slot }: { archive: MapTilesArchive; slot: MapTilesSlot }) =>
  `${slot}-${archive.build}`;

export const getCurrentArchive = (manifest: MapTilesManifest) => {
  const archive = manifest.slots[manifest.current];

  if (!archive) {
    throw new Error("The current slot must hold an archive");
  }

  return { archive, slot: manifest.current };
};

export const resolveArchive = ({
  manifest,
  now,
  requestedId,
}: {
  manifest: MapTilesManifest;
  now: number;
  requestedId: string | undefined;
}) => {
  const current = getCurrentArchive(manifest);
  const standbySlot = getOtherSlot(manifest.current);
  const standby = manifest.slots[standbySlot];

  if (
    standby?.servedUntil &&
    requestedId === getArchiveId({ archive: standby, slot: standbySlot }) &&
    now < Date.parse(standby.servedUntil)
  ) {
    return { archive: standby, id: requestedId, slot: standbySlot };
  }

  return { archive: current.archive, id: getArchiveId(current), slot: current.slot };
};

export const getStandbyReuseAt = (manifest: MapTilesManifest) => {
  const standby = manifest.slots[getOtherSlot(manifest.current)];

  if (!standby) {
    return null;
  }

  return standby.servedUntil ? Date.parse(standby.servedUntil) + SLOT_REUSE_MARGIN_MS : Infinity;
};

export const clearStandbySlot = ({
  manifest,
  now,
}: {
  manifest: MapTilesManifest;
  now: number;
}): MapTilesManifest => {
  const reuseAt = getStandbyReuseAt(manifest);

  if (reuseAt !== null && now < reuseAt) {
    throw new Error(
      `Slot ${getOtherSlot(manifest.current)} may still be in use until ${new Date(reuseAt).toISOString()}`,
    );
  }

  return { ...manifest, slots: { ...manifest.slots, [getOtherSlot(manifest.current)]: null } };
};

export const publishToStandby = ({
  archive: published,
  manifest,
  now,
}: {
  archive: MapTilesArchive;
  manifest: MapTilesManifest | null;
  now: number;
}): MapTilesManifest => {
  const { servedUntil: _servedUntil, ...archive } = published;

  if (!manifest) {
    return { current: "a", slots: { a: archive, b: null } };
  }

  const standbySlot = getOtherSlot(manifest.current);

  if (manifest.slots[standbySlot]) {
    throw new Error(`Slot ${standbySlot} must be cleared before it is replaced`);
  }

  const { archive: current } = getCurrentArchive(manifest);
  const { rejectedBuild: _rejectedBuild, ...kept } = manifest;

  return {
    ...kept,
    current: standbySlot,
    slots: {
      ...manifest.slots,
      [standbySlot]: archive,
      [manifest.current]: {
        ...current,
        servedUntil: new Date(now + ARCHIVE_GRACE_PERIOD_MS).toISOString(),
      },
    },
  };
};

export const rollbackToStandby = ({
  manifest,
  now,
}: {
  manifest: MapTilesManifest;
  now: number;
}): MapTilesManifest => {
  const standbySlot = getOtherSlot(manifest.current);
  const standby = manifest.slots[standbySlot];

  if (!standby) {
    throw new Error("There is no previous map to roll back to");
  }

  const { archive: current } = getCurrentArchive(manifest);
  const { servedUntil: _servedUntil, ...restored } = standby;

  return {
    ...manifest,
    current: standbySlot,
    rejectedBuild: current.build,
    slots: {
      ...manifest.slots,
      [standbySlot]: restored,
      [manifest.current]: { ...current, servedUntil: new Date(now).toISOString() },
    },
  };
};
