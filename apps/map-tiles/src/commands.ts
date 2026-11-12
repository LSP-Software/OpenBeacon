import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  clearStandbySlot,
  getArchiveId,
  getCurrentArchive,
  getOtherSlot,
  getSlotKey,
  getStandbyReuseAt,
  type MapTilesArchive,
  type MapTilesSlot,
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
  dryRun: boolean;
  env: MapTilesEnv;
  partClient: S3Client;
  yes: boolean;
};

const confirm = async ({ question, yes }: { question: string; yes: boolean }) => {
  if (yes) {
    return;
  }

  if (!process.stdin.isTTY) {
    throw new Error("Pass --yes to run without an interactive confirmation");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await readline.question(`${question} [y/N] `);
  readline.close();

  if (answer.trim().toLowerCase() !== "y") {
    throw new Error("Cancelled");
  }
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

const describeSlot = ({
  archive,
  now,
  slot,
}: {
  archive: MapTilesArchive | null;
  now: number;
  slot: MapTilesSlot;
}) => {
  if (!archive) {
    return `  ${slot}: empty`;
  }

  const description = `  ${slot}: ${archive.key} build ${archive.build} (${archive.schemaVersion}, ${formatBytes(archive.size)})`;

  if (!archive.servedUntil) {
    return `${description} current, published ${archive.publishedAt}`;
  }

  return now < Date.parse(archive.servedUntil)
    ? `${description} served to open maps until ${archive.servedUntil}`
    : `${description} kept for rollback`;
};

export const status = async ({ client, env }: Context) => {
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });
  const now = Date.now();

  console.log(`Bucket: ${env.R2_BUCKET}`);
  if (!manifest) {
    console.log("No manifest: the API serves R2_PM_TILES_KEY. Run adopt or publish to create one.");
  } else {
    console.log(`Current slot: ${manifest.manifest.current}`);
    for (const slot of ["a", "b"] as const) {
      console.log(describeSlot({ archive: manifest.manifest.slots[slot], now, slot }));
    }
    const reuseAt = getStandbyReuseAt(manifest.manifest);
    if (reuseAt !== null) {
      console.log(
        reuseAt === Infinity
          ? "The standby slot has no end date; roll back or clear it by hand"
          : `The standby slot can be replaced from ${new Date(reuseAt).toISOString()}`,
      );
    }
  }

  const tracked = new Set(
    manifest
      ? Object.values(manifest.manifest.slots).flatMap((archive) => (archive ? [archive.key] : []))
      : [],
  );
  const listed = await client.send(new ListObjectsV2Command({ Bucket: env.R2_BUCKET }));
  const untracked = (listed.Contents ?? []).filter(
    (object) => object.Key?.endsWith(".pmtiles") && !tracked.has(object.Key),
  );

  for (const object of untracked) {
    console.log(`Untracked archive: ${object.Key} (${formatBytes(object.Size ?? 0)})`);
  }

  const pendingUploads = await tryCatch(readdir(join(env.MAP_TILES_STATE_DIR, env.R2_BUCKET)));
  for (const file of pendingUploads.data ?? []) {
    console.log(`Resumable upload: ${file.replace(/\.json$/, "")}`);
  }
};

export const adopt = async (context: Context, key: string, date: string | undefined) => {
  const { client, dryRun, env } = context;

  if (await readManifest({ bucket: env.R2_BUCKET, client })) {
    throw new Error("A manifest already exists; adopt only creates the first one");
  }

  const build = date ?? key.match(/\d{8}/)?.[0];

  if (!build) {
    throw new Error(`Pass --date YYYYMMDD with the build date of ${key}`);
  }

  const object = await headObject({ bucket: env.R2_BUCKET, client, key });

  if (!object) {
    throw new Error(`${key} does not exist in ${env.R2_BUCKET}`);
  }

  const info = await readR2ArchiveInfo({ client, env, key });
  console.log(
    `Adopting ${key} build ${build} (${info.schemaVersion}, ${formatBytes(object.size)}) into slot a`,
  );

  if (dryRun) {
    return;
  }

  await writeManifest({
    bucket: env.R2_BUCKET,
    client,
    etag: null,
    manifest: publishToStandby({
      archive: {
        build,
        key,
        publishedAt: new Date().toISOString(),
        schemaVersion: info.schemaVersion,
        size: object.size,
      },
      manifest: null,
      now: Date.now(),
    }),
  });
  console.log("Manifest created");
};

export const rollback = async (context: Context) => {
  const { client, dryRun, env, yes } = context;
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });

  if (!manifest) {
    throw new Error("There is no manifest to roll back");
  }

  const next = rollbackToStandby({ manifest: manifest.manifest, now: Date.now() });
  const from = getCurrentArchive(manifest.manifest);
  const to = getCurrentArchive(next);

  if (!(await headObject({ bucket: env.R2_BUCKET, client, key: to.archive.key }))) {
    throw new Error(`${to.archive.key} is missing from R2`);
  }

  console.log(
    `Rolling back from ${getArchiveId(from)} to ${getArchiveId(to)}. Open maps on ${getArchiveId(from)} switch on their next URL refresh.`,
  );

  if (dryRun) {
    return;
  }

  await confirm({ question: "Roll back?", yes });
  await writeManifest({ bucket: env.R2_BUCKET, client, etag: manifest.etag, manifest: next });
  console.log("Rolled back");
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
  context: Context,
  { date, minIntervalMs }: { date: string | undefined; minIntervalMs?: number },
): Promise<PublishResult> => {
  const { client, dryRun, env, partClient, yes } = context;
  const build = pickProtomapsBuild({ builds: await listProtomapsBuilds(), date });
  const buildDate = getBuildDate(build);
  const url = getProtomapsBuildUrl(build);
  const initialManifest = await readManifest({ bucket: env.R2_BUCKET, client });
  const now = Date.now();
  const current = initialManifest ? getCurrentArchive(initialManifest.manifest) : null;

  if (current?.archive.build === buildDate) {
    return { published: false, message: `Build ${buildDate} is already current` };
  }

  if (current && !date && buildDate < current.archive.build) {
    return {
      published: false,
      message: `The newest Protomaps build ${buildDate} is older than the current build ${current.archive.build}`,
    };
  }

  if (current && minIntervalMs !== undefined) {
    const dueAt = Date.parse(current.archive.publishedAt) + minIntervalMs;
    if (now < dueAt) {
      return {
        published: false,
        message: `The next map update is due from ${new Date(dueAt).toISOString()}`,
      };
    }
  }

  if (!initialManifest && env.R2_PM_TILES_KEY) {
    if (await headObject({ bucket: env.R2_BUCKET, client, key: env.R2_PM_TILES_KEY })) {
      throw new Error(
        `${env.R2_PM_TILES_KEY} is already in ${env.R2_BUCKET}; run adopt first so the bucket keeps two maps`,
      );
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
      `Current: ${current ? `${current.archive.key} build ${current.archive.build}` : "no manifest"}`,
      env.maxBytesPerSecond === null
        ? "Bandwidth: unlimited (set MAP_TILES_MAX_MBPS to cap it); the ETA appears once the speed is measured"
        : `Bandwidth: capped at ${formatMbps(env.maxBytesPerSecond)}, about ${formatDuration(source.size / env.maxBytesPerSecond)} for a full upload`,
    ].join("\n"),
  );

  if (dryRun) {
    return { published: false, message: "Dry run; nothing was written" };
  }

  await confirm({ question: `Replace slot ${slot} with build ${buildDate}?`, yes });

  if (initialManifest && replaced) {
    await writeManifest({
      bucket: env.R2_BUCKET,
      client,
      etag: initialManifest.etag,
      manifest: clearStandbySlot({ manifest: initialManifest.manifest, now }),
    });
    console.log(`Cleared slot ${slot}; it can no longer be rolled back to`);

    if (replaced.key !== key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: replaced.key }));
      console.log(`Deleted ${replaced.key}`);
    }
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
      throw new Error(`Upload stopped: ${result.error.message}. Rerun the same command to resume.`);
    }

    if (!(await matchesSource())) {
      throw new Error(
        `${key} in R2 does not match build ${buildDate}, so it was not published. Rerun to upload it again.`,
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
