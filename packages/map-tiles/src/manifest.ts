import { z } from "zod";

export const MAP_TILES_MANIFEST_KEY = "pmtiles-manifest.json";
export const ARCHIVE_GRACE_PERIOD_MS = 8 * 24 * 60 * 60 * 1000;
export const ARCHIVE_DELETE_MARGIN_MS = 24 * 60 * 60 * 1000;

const archiveSchema = z
  .object({
    key: z.string().min(1),
    size: z.number().int().positive(),
    schemaVersion: z.string().min(1),
    publishedAt: z.iso.datetime(),
  })
  .strict();

const previousArchiveSchema = archiveSchema.extend({ servedUntil: z.iso.datetime() }).strict();

export const mapTilesManifestSchema = z
  .object({
    current: archiveSchema,
    previous: z.array(previousArchiveSchema),
  })
  .strict();

export type MapTilesArchive = z.infer<typeof archiveSchema>;
export type MapTilesManifest = z.infer<typeof mapTilesManifestSchema>;

const toDate = (value: string) => new Date(value).getTime();

export const resolveArchiveKey = ({
  manifest,
  now,
  requestedKey,
}: {
  manifest: MapTilesManifest;
  now: number;
  requestedKey: string | undefined;
}) => {
  if (!requestedKey || requestedKey === manifest.current.key) {
    return manifest.current.key;
  }

  const previous = manifest.previous.find((archive) => archive.key === requestedKey);

  if (previous && now < toDate(previous.servedUntil)) {
    return previous.key;
  }

  return manifest.current.key;
};

export const publishArchive = ({
  archive,
  manifest,
  now,
}: {
  archive: MapTilesArchive;
  manifest: MapTilesManifest | null;
  now: number;
}): MapTilesManifest => {
  if (!manifest) {
    return { current: archive, previous: [] };
  }

  if (manifest.current.key === archive.key) {
    throw new Error(`${archive.key} is already the current archive`);
  }

  return {
    current: archive,
    previous: [
      {
        ...manifest.current,
        servedUntil: new Date(now + ARCHIVE_GRACE_PERIOD_MS).toISOString(),
      },
      ...manifest.previous.filter((previous) => previous.key !== archive.key),
    ],
  };
};

export const rollbackArchive = ({
  manifest,
  now,
}: {
  manifest: MapTilesManifest;
  now: number;
}): MapTilesManifest => {
  const [target, ...rest] = manifest.previous;

  if (!target) {
    throw new Error("There is no previous archive to roll back to");
  }

  const { servedUntil: _servedUntil, ...current } = target;

  return {
    current,
    previous: [{ ...manifest.current, servedUntil: new Date(now).toISOString() }, ...rest],
  };
};

export const getPrunableArchives = ({
  manifest,
  now,
}: {
  manifest: MapTilesManifest;
  now: number;
}) =>
  manifest.previous.filter(
    (archive) =>
      archive.key !== manifest.current.key &&
      now >= toDate(archive.servedUntil) + ARCHIVE_DELETE_MARGIN_MS,
  );

export const removeArchives = ({
  keys,
  manifest,
}: {
  keys: string[];
  manifest: MapTilesManifest;
}): MapTilesManifest => ({
  current: manifest.current,
  previous: manifest.previous.filter((archive) => !keys.includes(archive.key)),
});
