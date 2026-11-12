import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  clearStandbySlot,
  getArchiveId,
  getCurrentArchive,
  getOtherSlot,
  getSlotKey,
  getStandbyReuseAt,
  type MapTilesArchive,
  publishToStandby,
  readManifest,
  rollbackToStandby,
  writeManifest,
} from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import type { MapTilesEnv } from "./env.ts";
import { readArchiveInfo } from "./pmtiles.ts";
import { headObject, readObjectRange } from "./r2.ts";
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
import { PART_SIZE, planParts, uploadArchive } from "./upload.ts";

export type Context = {
  client: S3Client;
  env: MapTilesEnv;
  partClient: S3Client;
};

const readR2ArchiveInfo = ({
  client,
  env,
  key,
}: {
  client: S3Client;
  env: MapTilesEnv;
  key: string;
}) =>
  readArchiveInfo((start, length) =>
    readObjectRange({ bucket: env.R2_BUCKET, client, key, length, start }),
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

export const readMapStatus = async ({ client, env }: Context): Promise<MapStatus> => {
  const manifest = (await readManifest({ bucket: env.R2_BUCKET, client }))?.manifest ?? null;
  const reuseAt = manifest ? getStandbyReuseAt(manifest) : null;
  const current = manifest ? getCurrentArchive(manifest) : null;
  const dueAt = current
    ? Math.max(
        Date.parse(current.archive.publishedAt) + env.updateIntervalMs,
        reuseAt !== null && reuseAt !== Infinity ? reuseAt : 0,
      )
    : null;
  const tracked = new Set(
    manifest
      ? Object.values(manifest.slots).flatMap((archive) => (archive ? [archive.key] : []))
      : [],
  );
  const listed = await client.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET }));
  const pendingUploads = await tryCatch(readdir(join(env.MAP_TILES_STATE_DIR, env.R2_BUCKET)));

  return {
    bucket: env.R2_BUCKET,
    current: manifest?.current ?? null,
    slots: {
      a: describeSlot(manifest?.slots.a ?? null),
      b: describeSlot(manifest?.slots.b ?? null),
    },
    standbyReplaceableFrom:
      reuseAt === null ? null : reuseAt === Infinity ? "never" : new Date(reuseAt).toISOString(),
    nextUpdateDueAt: dueAt === null ? null : new Date(dueAt).toISOString(),
    untrackedArchives: (listed.Contents ?? []).flatMap((object) =>
      object.Key?.endsWith(".pmtiles") && !tracked.has(object.Key)
        ? [{ key: object.Key, size: object.Size ?? 0 }]
        : [],
    ),
    resumableUploads: (pendingUploads.data ?? []).map((file) => file.replace(/\.json$/, "")),
  };
};

export const rollback = async ({ client, env }: Context) => {
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });

  if (!manifest) {
    throw new Error("There is no map to roll back from yet");
  }

  const next = rollbackToStandby({
    manifest: manifest.manifest,
    now: Date.now(),
  });
  const from = getCurrentArchive(manifest.manifest);
  const to = getCurrentArchive(next);

  if (!(await headObject({ bucket: env.R2_BUCKET, client, key: to.archive.key }))) {
    throw new Error(`${to.archive.key} is missing from R2`);
  }

  await writeManifest({
    bucket: env.R2_BUCKET,
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
  const interactive = process.stdout.isTTY === true;
  let doneBytes = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const render = () => {
    const snapshot = tracker.snapshot({ doneBytes, totalBytes });
    const line = [
      `${formatBytes(doneBytes)} / ${formatBytes(totalBytes)} (${snapshot.percent.toFixed(1)}%)`,
      snapshot.bytesPerSecond === null ? "measuring speed" : formatMbps(snapshot.bytesPerSecond),
      snapshot.etaSeconds === null ? "ETA pending" : `ETA ${formatDuration(snapshot.etaSeconds)}`,
    ].join("  ");

    if (interactive) {
      process.stdout.write(`\r\x1b[K${line}`);
    } else {
      console.log(line);
    }
  };

  return {
    onProgress: (bytesDelta: number) => {
      doneBytes += bytesDelta;
      if (bytesDelta > 0) {
        tracker.transferred(bytesDelta);
      }
    },
    start: (completedBytes: number) => {
      doneBytes = completedBytes;
      timer = setInterval(render, interactive ? 1000 : 30_000);
    },
    stop: () => {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      render();
      if (interactive) {
        process.stdout.write("\n");
      }
    },
  };
};

export type PublishResult = { published: boolean; message: string };

export const publish = async (
  { client, env, partClient }: Context,
  { ignoreInterval }: { ignoreInterval: boolean },
): Promise<PublishResult> => {
  const build = pickProtomapsBuild({ builds: await listProtomapsBuilds(), date: undefined });
  const buildDate = getBuildDate(build);
  const url = getProtomapsBuildUrl(build);
  const initialManifest = await readManifest({ bucket: env.R2_BUCKET, client });
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

  if (current && !ignoreInterval) {
    const dueAt = Date.parse(current.archive.publishedAt) + env.updateIntervalMs;
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

  const slot = initialManifest ? getOtherSlot(initialManifest.manifest.current) : "a";
  const key = getSlotKey(slot);
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
      `Target: ${env.R2_BUCKET}/${key} (slot ${slot})`,
      `Replaces: ${replaced ? `${replaced.key} build ${replaced.build}` : "nothing"}`,
      `Current: ${current ? `${current.archive.key} build ${current.archive.build}` : "none yet"}`,
      env.maxBytesPerSecond === null
        ? "Bandwidth: unlimited (set MAP_TILES_MAX_MBPS to cap it); the ETA appears once the speed is measured"
        : `Bandwidth: capped at ${formatMbps(env.maxBytesPerSecond)}, about ${formatDuration(source.size / env.maxBytesPerSecond)} for a full upload`,
    ].join("\n"),
  );

  if (initialManifest && replaced) {
    await writeManifest({
      bucket: env.R2_BUCKET,
      client,
      etag: initialManifest.etag,
      manifest: clearStandbySlot({ manifest: initialManifest.manifest, now }),
    });
    console.log(`Cleared slot ${slot}; it can no longer be rolled back to`);
  }

  const matchesSource = async () => {
    const uploaded = await headObject({ bucket: env.R2_BUCKET, client, key });
    if (uploaded?.size !== source.size) {
      return false;
    }
    const uploadedInfo = await readR2ArchiveInfo({ client, env, key });
    return (
      uploadedInfo.schemaVersion === sourceInfo.schemaVersion &&
      Buffer.from(uploadedInfo.headBytes).equals(Buffer.from(sourceInfo.headBytes))
    );
  };

  if (await matchesSource()) {
    console.log(`${key} already holds build ${buildDate}; verifying it`);
  } else {
    const reporter = createProgressReporter(source.size);
    const result = await tryCatch(
      uploadArchive({
        bucket: env.R2_BUCKET,
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
    reporter.stop();

    if (result.error) {
      throw new Error(`Upload stopped: ${result.error.message}. The next update resumes it.`);
    }

    if (!(await matchesSource())) {
      throw new Error(
        `${key} in R2 does not match build ${buildDate}, so it was not published. The next update uploads it again.`,
      );
    }
  }

  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });
  await writeManifest({
    bucket: env.R2_BUCKET,
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
