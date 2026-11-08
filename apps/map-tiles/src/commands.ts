import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DeleteObjectCommand, ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import {
  getPrunableArchives,
  type MapTilesManifest,
  publishArchive,
  readManifest,
  removeArchives,
  rollbackArchive,
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

type Context = {
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

const describeServing = (manifest: MapTilesManifest, now: number) =>
  manifest.previous.map((archive) => {
    const servedUntil = Date.parse(archive.servedUntil);
    const state =
      now < servedUntil
        ? `served to pinned clients until ${archive.servedUntil}`
        : `no longer served since ${archive.servedUntil}`;
    return `  ${archive.key} (${archive.schemaVersion}, ${formatBytes(archive.size)}) ${state}`;
  });

export const status = async ({ client, env }: Context) => {
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });

  console.log(`Bucket: ${env.R2_BUCKET}`);
  if (!manifest) {
    console.log("No manifest: the API serves R2_PM_TILES_KEY. Run adopt to create one.");
  } else {
    const { current } = manifest.manifest;
    console.log(
      `Current: ${current.key} (${current.schemaVersion}, ${formatBytes(current.size)}) published ${current.publishedAt}`,
    );
    const previous = describeServing(manifest.manifest, Date.now());
    console.log(previous.length > 0 ? ["Previous:", ...previous].join("\n") : "Previous: none");
  }

  const tracked = new Set(
    manifest
      ? [manifest.manifest.current.key, ...manifest.manifest.previous.map((a) => a.key)]
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

export const prune = async ({ client, dryRun, env }: Context) => {
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });

  if (!manifest) {
    console.log("No manifest; nothing to prune");
    return;
  }

  const prunable = getPrunableArchives({ manifest: manifest.manifest, now: Date.now() });

  if (prunable.length === 0) {
    console.log("No archives are ready to delete");
    return;
  }

  for (const archive of prunable) {
    console.log(`${dryRun ? "Would delete" : "Deleting"} ${archive.key}`);
    if (!dryRun) {
      await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: archive.key }));
    }
  }

  if (!dryRun) {
    await writeManifest({
      bucket: env.R2_BUCKET,
      client,
      etag: manifest.etag,
      manifest: removeArchives({
        keys: prunable.map((archive) => archive.key),
        manifest: manifest.manifest,
      }),
    });
  }
};

export const adopt = async (context: Context, key: string) => {
  const { client, dryRun, env } = context;

  if (await readManifest({ bucket: env.R2_BUCKET, client })) {
    throw new Error("A manifest already exists; adopt only creates the first one");
  }

  const object = await headObject({ bucket: env.R2_BUCKET, client, key });

  if (!object) {
    throw new Error(`${key} does not exist in ${env.R2_BUCKET}`);
  }

  const info = await readR2ArchiveInfo({ client, env, key });
  console.log(
    `Adopting ${key} (${info.schemaVersion}, ${formatBytes(object.size)}) as the current archive`,
  );

  if (dryRun) {
    return;
  }

  await writeManifest({
    bucket: env.R2_BUCKET,
    client,
    etag: null,
    manifest: {
      current: {
        key,
        publishedAt: new Date().toISOString(),
        schemaVersion: info.schemaVersion,
        size: object.size,
      },
      previous: [],
    },
  });
  console.log("Manifest created");
};

export const rollback = async (context: Context) => {
  const { client, dryRun, env, yes } = context;
  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });

  if (!manifest) {
    throw new Error("There is no manifest to roll back");
  }

  const next = rollbackArchive({ manifest: manifest.manifest, now: Date.now() });

  if (!(await headObject({ bucket: env.R2_BUCKET, client, key: next.current.key }))) {
    throw new Error(`${next.current.key} has already been deleted from R2`);
  }

  console.log(
    `Rolling back from ${manifest.manifest.current.key} to ${next.current.key}. Clients using ${manifest.manifest.current.key} switch on their next URL refresh.`,
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

export const publish = async (context: Context, date: string | undefined) => {
  const { client, dryRun, env, partClient, yes } = context;
  const build = pickProtomapsBuild({ builds: await listProtomapsBuilds(), date });
  const key = `planet-${getBuildDate(build)}.pmtiles`;
  const url = getProtomapsBuildUrl(build);
  const initialManifest = await readManifest({ bucket: env.R2_BUCKET, client });

  if (initialManifest?.manifest.current.key === key) {
    console.log(`${key} is already the current archive`);
    if (!dryRun) {
      await prune(context);
    }
    return;
  }

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
  const existing = await headObject({ bucket: env.R2_BUCKET, client, key });

  if (existing && existing.size !== source.size) {
    throw new Error(
      `${key} already exists in ${env.R2_BUCKET} with a different size; archive keys are never overwritten`,
    );
  }

  console.log(
    [
      `Build: ${build.key} (basemap schema ${sourceInfo.schemaVersion})`,
      `Size: ${formatBytes(source.size)} in ${planParts({ partSize: PART_SIZE, size: source.size }).length} parts`,
      `Target: ${env.R2_BUCKET}/${key}`,
      `Current: ${initialManifest?.manifest.current.key ?? "no manifest"}`,
      env.maxBytesPerSecond === null
        ? "Bandwidth: unlimited (set MAP_TILES_MAX_MBPS to cap it); the ETA appears once the speed is measured"
        : `Bandwidth: capped at ${formatMbps(env.maxBytesPerSecond)}, about ${formatDuration(source.size / env.maxBytesPerSecond)} for a full upload`,
    ].join("\n"),
  );

  if (dryRun) {
    return;
  }

  if (existing) {
    console.log(`${key} is already uploaded; verifying it`);
  } else {
    await confirm({ question: `Upload ${formatBytes(source.size)} to ${env.R2_BUCKET}?`, yes });
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
  }

  const uploaded = await headObject({ bucket: env.R2_BUCKET, client, key });
  const uploadedInfo = await readR2ArchiveInfo({ client, env, key });

  if (
    uploaded?.size !== source.size ||
    uploadedInfo.schemaVersion !== sourceInfo.schemaVersion ||
    !Buffer.from(uploadedInfo.headBytes).equals(Buffer.from(sourceInfo.headBytes))
  ) {
    throw new Error(`${key} in R2 does not match the Protomaps build; it was not published`);
  }

  const manifest = await readManifest({ bucket: env.R2_BUCKET, client });
  const now = Date.now();
  await writeManifest({
    bucket: env.R2_BUCKET,
    client,
    etag: manifest?.etag ?? null,
    manifest: publishArchive({
      archive: {
        key,
        publishedAt: new Date(now).toISOString(),
        schemaVersion: sourceInfo.schemaVersion,
        size: source.size,
      },
      manifest: manifest?.manifest ?? null,
      now,
    }),
  });
  console.log(`Published ${key}. The API serves it to newly opened maps within about a minute.`);
  await prune(context);
};
