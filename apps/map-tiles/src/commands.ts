import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  clearStandbySlot,
  getArchiveId,
  getCurrentArchive,
  getOtherSlot,
  getSlotKey,
  getStandbyReuseAt,
  MAP_TILES_MANIFEST_KEY,
  type MapTilesArchive,
  publishToStandby,
  readManifest,
  rollbackToStandby,
  writeManifest,
} from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import type { MapTilesEnv } from "./env.ts";
import { readArchiveInfo } from "./pmtiles.ts";
import { headObject, readObjectRange } from "./storage.ts";
import {
  fetchSourceRange,
  getBuildDate,
  getProtomapsBuildUrl,
  headSource,
  listProtomapsBuilds,
  pickProtomapsBuild,
} from "./source.ts";
import type { MapStatus } from "./status.ts";
import {
  createProgressTracker,
  createRateLimiter,
  formatBytes,
  formatDuration,
  formatMbps,
} from "./transfer.ts";
import {
  getUploadStatePath,
  PART_SIZE,
  planParts,
  readUploadState,
  uploadArchive,
} from "./upload.ts";

export type Context = {
  client: S3Client;
  env: MapTilesEnv;
  partClient: S3Client;
};

const readStoredArchiveInfo = ({
  client,
  env,
  key,
}: {
  client: S3Client;
  env: MapTilesEnv;
  key: string;
}) =>
  readArchiveInfo((start, length) =>
    readObjectRange({ bucket: env.MAP_S3_BUCKET_NAME, client, key, length, start }),
  );

const describeSlot = (archive: MapTilesArchive | null) =>
  archive
    ? {
        build: archive.build,
        publishedAt: archive.publishedAt,
        schemaVersion: archive.schemaVersion,
        servedUntil: archive.servedUntil ?? null,
        size: archive.size,
      }
    : null;

const getUpdateDueAt = ({ archive, env }: { archive: MapTilesArchive; env: MapTilesEnv }) =>
  Date.parse(
    `${archive.build.slice(0, 4)}-${archive.build.slice(4, 6)}-${archive.build.slice(6, 8)}T00:00:00.000Z`,
  ) + env.updateIntervalMs;

export const readMapStatus = async ({ client, env }: Context): Promise<MapStatus> => {
  const manifest =
    (await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client }))?.manifest ?? null;
  const reuseAt = manifest ? getStandbyReuseAt(manifest) : null;
  const current = manifest ? getCurrentArchive(manifest) : null;
  const dueAt = current
    ? Math.max(
        getUpdateDueAt({ archive: current.archive, env }),
        reuseAt !== null && reuseAt !== Infinity ? reuseAt : 0,
      )
    : null;
  const tracked = new Set(
    manifest
      ? Object.values(manifest.slots).flatMap((archive) => (archive ? [archive.key] : []))
      : [],
  );
  const listed = await client.send(new ListObjectsV2Command({ Bucket: env.MAP_S3_BUCKET_NAME }));
  const pendingUploads = await tryCatch(
    readdir(join(env.MAP_TILES_STATE_DIR, env.MAP_S3_BUCKET_NAME)),
  );

  return {
    bucket: env.MAP_S3_BUCKET_NAME,
    current: manifest?.current ?? null,
    slots: {
      a: describeSlot(manifest?.slots.a ?? null),
      b: describeSlot(manifest?.slots.b ?? null),
    },
    standbyReplaceableFrom:
      reuseAt === null ? null : reuseAt === Infinity ? "never" : new Date(reuseAt).toISOString(),
    nextUpdateDueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
    rejectedBuild: manifest?.rejectedBuild ?? null,
    speedLimitMbps: env.MAP_TILES_MAX_MBPS ?? null,
    untrackedArchives: (listed.Contents ?? []).flatMap((object) =>
      object.Key?.endsWith(".pmtiles") && !tracked.has(object.Key)
        ? [{ key: object.Key, size: object.Size ?? 0 }]
        : [],
    ),
    resumableUploads: (pendingUploads.data ?? []).map((file) => file.replace(/\.json$/, "")),
  };
};

export const repairManifest = async ({ client, env }: Context) => {
  const stored = await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client });

  if (!stored) {
    return null;
  }

  const { etag, manifest } = stored;
  const standbySlot = getOtherSlot(manifest.current);
  const current = getCurrentArchive(manifest).archive;
  const standby = manifest.slots[standbySlot];
  const currentExists = await headObject({
    bucket: env.MAP_S3_BUCKET_NAME,
    client,
    key: current.key,
  });
  const standbyExists = standby
    ? await headObject({ bucket: env.MAP_S3_BUCKET_NAME, client, key: standby.key })
    : null;

  if (currentExists && (!standby || standbyExists)) {
    return null;
  }

  if (currentExists && standby) {
    await writeManifest({
      bucket: env.MAP_S3_BUCKET_NAME,
      client,
      etag,
      manifest: { ...manifest, slots: { ...manifest.slots, [standbySlot]: null } },
    });
    return `${standby.key} is missing from map storage, so slot ${standbySlot} was removed from the manifest`;
  }

  if (standby && standbyExists) {
    const { servedUntil: _servedUntil, ...restored } = standby;
    await writeManifest({
      bucket: env.MAP_S3_BUCKET_NAME,
      client,
      etag,
      manifest: {
        ...manifest,
        current: standbySlot,
        slots: { ...manifest.slots, [standbySlot]: restored, [manifest.current]: null },
      },
    });
    return `${current.key} is missing from map storage, so the map rolled back to slot ${standbySlot} (Protomaps build ${standby.build})`;
  }

  if ((await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client }))?.etag !== etag) {
    return "The manifest changed while it was being checked, so it was left alone";
  }

  await client.send(
    new DeleteObjectCommand({ Bucket: env.MAP_S3_BUCKET_NAME, Key: MAP_TILES_MANIFEST_KEY }),
  );
  return "No map in the manifest is in map storage, so the manifest was removed and the map is downloaded again";
};

export const rollback = async ({ client, env }: Context) => {
  const manifest = await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client });

  if (!manifest) {
    throw new Error("There is no map to roll back from yet");
  }

  const next = rollbackToStandby({
    manifest: manifest.manifest,
    now: Date.now(),
  });
  const from = getCurrentArchive(manifest.manifest);
  const to = getCurrentArchive(next);

  if (!(await headObject({ bucket: env.MAP_S3_BUCKET_NAME, client, key: to.archive.key }))) {
    throw new Error(`${to.archive.key} is missing from map storage`);
  }

  await writeManifest({
    bucket: env.MAP_S3_BUCKET_NAME,
    client,
    etag: manifest.etag,
    manifest: next,
  });

  const message = `Rolled back from ${getArchiveId(from)} to ${getArchiveId(to)}. Open maps on ${getArchiveId(from)} switch on their next URL refresh.`;
  console.log(message);
  return message;
};

const createProgressReporter = (totalBytes: number) => {
  const tracker = createProgressTracker();
  let doneBytes = 0;
  let startedBytes = 0;
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const log = () => {
    const snapshot = tracker.snapshot({ doneBytes, totalBytes });
    const progress = `Transferred ${formatBytes(doneBytes)} of ${formatBytes(totalBytes)} (${snapshot.percent.toFixed(1)}%)`;

    if (snapshot.stalled) {
      console.log(`${progress}, no progress in the last minute`);
    } else if (snapshot.bytesPerSecond === null || snapshot.etaSeconds === null) {
      console.log(`${progress}, measuring speed`);
    } else {
      console.log(
        `${progress}, at ${formatMbps(snapshot.bytesPerSecond)}, about ${formatDuration(snapshot.etaSeconds)} left (done around ${new Date(Date.now() + snapshot.etaSeconds * 1000).toISOString()})`,
      );
    }
  };

  return {
    onProgress: (bytesDelta: number) => {
      doneBytes += bytesDelta;
      tracker.transferred(bytesDelta);
    },
    start: (completedBytes: number) => {
      doneBytes = completedBytes;
      startedBytes = completedBytes;
      startedAt = performance.now();
      console.log("Download starting; progress updates every 60 seconds until it completes");
      timer = setInterval(log, 60_000);
    },
    stop: ({ succeeded }: { succeeded: boolean }) => {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      if (succeeded) {
        console.log(
          `Transferred ${formatBytes(doneBytes - startedBytes)} in ${formatDuration((performance.now() - startedAt) / 1000)}`,
        );
      }
    },
  };
};

export type PublishResult = { published: boolean; message: string };

export const publish = async (
  { client, env, partClient }: Context,
  { manual }: { manual: boolean },
): Promise<PublishResult> => {
  const build = pickProtomapsBuild({ builds: await listProtomapsBuilds(), date: undefined });
  const buildDate = getBuildDate(build);
  const url = getProtomapsBuildUrl(build);
  const initialManifest = await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client });
  const now = Date.now();
  const current = initialManifest ? getCurrentArchive(initialManifest.manifest) : null;

  if (current?.archive.build === buildDate) {
    return { published: false, message: `Build ${buildDate} is already current` };
  }

  if (current && buildDate < current.archive.build) {
    return {
      published: false,
      message: `The newest Protomaps build ${buildDate} is older than the current build ${current.archive.build}`,
    };
  }

  const slot = initialManifest ? getOtherSlot(initialManifest.manifest.current) : "a";
  const key = getSlotKey(slot);
  const statePath = getUploadStatePath({
    bucket: env.MAP_S3_BUCKET_NAME,
    key,
    stateDir: env.MAP_TILES_STATE_DIR,
  });
  const resuming = (await readUploadState(statePath))?.sourceUrl === url;

  const rejectedBuild = initialManifest?.manifest.rejectedBuild;

  if (!manual && !resuming && rejectedBuild && buildDate <= rejectedBuild) {
    return {
      published: false,
      message: `Build ${rejectedBuild} was rolled back, so it is skipped until Protomaps publishes a newer build`,
    };
  }

  if (current && !manual && !resuming) {
    const dueAt = getUpdateDueAt({ archive: current.archive, env });
    if (now < dueAt) {
      return {
        published: false,
        message: `The next map update is due from ${new Date(dueAt).toISOString()}`,
      };
    }
  }

  const reuseAt = initialManifest ? getStandbyReuseAt(initialManifest.manifest) : null;

  if (reuseAt !== null && now < reuseAt) {
    return {
      published: false,
      message:
        reuseAt === Infinity
          ? "The standby slot has no end date, so it is not replaced"
          : `The standby slot may be in use until ${new Date(reuseAt).toISOString()}`,
    };
  }

  const replaced = initialManifest?.manifest.slots[slot] ?? null;
  const source = await headSource(url);

  if (source.size !== build.size) {
    throw new Error(
      `Protomaps lists ${build.size} bytes for ${build.key} but serves ${source.size}`,
    );
  }

  const sourceInfo = await readArchiveInfo(async (start, length) => {
    const response = await fetchSourceRange({ etag: source.etag, length, start, url });
    return new Uint8Array(await response.arrayBuffer());
  });

  console.log(
    [
      `Build: ${build.key} (basemap schema ${sourceInfo.schemaVersion})`,
      `Size: ${formatBytes(source.size)} in ${planParts({ partSize: PART_SIZE, size: source.size }).length} parts`,
      `Target: ${env.MAP_S3_BUCKET_NAME}/${key} (slot ${slot})`,
      `Replaces: ${replaced ? `${replaced.key} build ${replaced.build}` : "nothing"}`,
      `Current: ${current ? `${current.archive.key} build ${current.archive.build}` : "none yet"}`,
      env.maxBytesPerSecond === null
        ? "Bandwidth: unlimited (set MAP_TILES_MAX_MBPS to cap it); the ETA appears once the speed is measured"
        : `Bandwidth: capped at ${formatMbps(env.maxBytesPerSecond)}, about ${formatDuration(source.size / env.maxBytesPerSecond)} for a full upload`,
    ].join("\n"),
  );

  if (initialManifest && replaced) {
    await writeManifest({
      bucket: env.MAP_S3_BUCKET_NAME,
      client,
      etag: initialManifest.etag,
      manifest: clearStandbySlot({ manifest: initialManifest.manifest, now }),
    });
    console.log(`Cleared slot ${slot}; it can no longer be rolled back to`);
  }

  const matchesSource = async () => {
    const uploaded = await headObject({ bucket: env.MAP_S3_BUCKET_NAME, client, key });
    if (uploaded?.size !== source.size) {
      return false;
    }
    const uploadedInfo = await readStoredArchiveInfo({ client, env, key });
    return (
      uploadedInfo.schemaVersion === sourceInfo.schemaVersion &&
      Buffer.from(uploadedInfo.headBytes).equals(Buffer.from(sourceInfo.headBytes))
    );
  };

  if (await matchesSource()) {
    console.log(`${key} already holds build ${buildDate}; verifying it`);
    await rm(statePath, { force: true });
  } else {
    const reporter = createProgressReporter(source.size);
    const result = await tryCatch(
      uploadArchive({
        bucket: env.MAP_S3_BUCKET_NAME,
        client,
        downloadLimiter: createRateLimiter({ bytesPerSecond: env.maxBytesPerSecond }),
        key,
        onProgress: reporter.onProgress,
        onStart: ({ completedBytes, completedParts, totalParts }) => {
          if (completedParts > 0) {
            console.log(`Resuming: ${completedParts} of ${totalParts} parts already uploaded`);
          }
          reporter.start(completedBytes);
        },
        partClient,
        source: { ...source, url },
        stateDir: env.MAP_TILES_STATE_DIR,
        uploadLimiter: createRateLimiter({ bytesPerSecond: env.maxBytesPerSecond }),
      }),
    );
    reporter.stop({ succeeded: !result.error });

    if (result.error) {
      throw new Error(`Upload stopped: ${result.error.message}. The next update resumes it.`);
    }

    if (!(await matchesSource())) {
      throw new Error(
        `${key} in map storage does not match build ${buildDate}, so it was not published. The next update uploads it again.`,
      );
    }
  }

  const manifest = await readManifest({ bucket: env.MAP_S3_BUCKET_NAME, client });
  await writeManifest({
    bucket: env.MAP_S3_BUCKET_NAME,
    client,
    etag: manifest?.etag ?? null,
    manifest: publishToStandby({
      archive: {
        build: buildDate,
        key,
        publishedAt: new Date().toISOString(),
        schemaVersion: sourceInfo.schemaVersion,
        size: source.size,
      },
      manifest: manifest?.manifest ?? null,
      now: Date.now(),
    }),
  });

  return {
    published: true,
    message: `Published build ${buildDate} to slot ${slot}. Newly opened maps use it within about a minute.`,
  };
};
