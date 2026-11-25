import { Readable, Transform } from "node:stream";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  getMirroredBoundariesKey,
  getMirroredPackKey,
  type MirroredSpeedLimitPacks,
  RETIRED_PACK_GRACE_PERIOD_MS,
  readMirroredSpeedLimitPacks,
  SPEED_LIMIT_PACKS_MANIFEST_URL,
  speedLimitPackManifestSchema,
  writeMirroredSpeedLimitPacks,
} from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";

const isStored = async ({
  bucket,
  client,
  key,
  sha256,
  size,
}: {
  bucket: string;
  client: S3Client;
  key: string;
  sha256: string;
  size: number;
}) => {
  const result = await tryCatch(client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })));

  if (result.error) {
    if (result.error.name === "NotFound" || result.error.name === "NoSuchKey") {
      return false;
    }
    throw result.error;
  }

  return result.data.ContentLength === size && result.data.Metadata?.["sha256"] === sha256;
};

const copyFile = async ({
  bucket,
  client,
  contentType,
  fetchFile,
  key,
  sha256,
  size,
  uploadClient,
  url,
}: {
  bucket: string;
  client: S3Client;
  contentType: string;
  fetchFile: (url: string) => Promise<Response>;
  key: string;
  sha256: string;
  size: number;
  uploadClient: S3Client;
  url: string;
}) => {
  const response = await fetchFile(url);

  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${url}: HTTP ${response.status}`);
  }

  const hasher = new Bun.CryptoHasher("sha256");
  let received = 0;
  const body = Readable.from(response.body).pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hasher.update(chunk);
        received += chunk.length;
        callback(null, chunk);
      },
    }),
  );

  await uploadClient.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: size,
      ContentType: contentType,
      CacheControl: "private, max-age=31536000, immutable",
      Metadata: { sha256 },
    }),
  );

  if (received !== size || hasher.digest("hex") !== sha256) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    throw new Error(`${url} doesn't match the speed limit pack manifest`);
  }
};

export const mirrorSpeedLimitPacks = async ({
  bucket,
  client,
  fetchFile = (url) => fetch(url, { signal: AbortSignal.timeout(3_600_000) }),
  manifestUrl = SPEED_LIMIT_PACKS_MANIFEST_URL,
  now = Date.now,
  uploadClient,
}: {
  bucket: string;
  client: S3Client;
  fetchFile?: (url: string) => Promise<Response>;
  manifestUrl?: string;
  now?: () => number;
  uploadClient: S3Client;
}) => {
  const response = await fetchFile(manifestUrl);

  if (!response.ok) {
    throw new Error(`Could not read the speed limit pack manifest: HTTP ${response.status}`);
  }

  const published = speedLimitPackManifestSchema.parse(await response.json());
  const stored = await readMirroredSpeedLimitPacks({ bucket, client });
  const boundaries = {
    ...published.boundaries,
    contentType: "application/json",
    key: getMirroredBoundariesKey(published.boundaries.sha256),
  };
  const regions = published.regions.map((region) => ({
    ...region,
    contentType: "application/octet-stream",
    key: getMirroredPackKey(region),
  }));
  const files = [boundaries, ...regions];
  const liveKeys = new Set(files.map(({ key }) => key));
  const unchanged =
    stored !== null &&
    stored.manifest.build === published.build &&
    stored.manifest.boundaries.key === boundaries.key &&
    stored.manifest.regions.length === published.regions.length &&
    stored.manifest.regions.every(({ key }) => liveKeys.has(key));

  const retired: MirroredSpeedLimitPacks["retired"] = [];
  let deleted = 0;
  for (const entry of stored?.manifest.retired ?? []) {
    if (liveKeys.has(entry.key)) {
      continue;
    }
    if (now() >= Date.parse(entry.retiredAt) + RETIRED_PACK_GRACE_PERIOD_MS) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: entry.key }));
      deleted += 1;
    } else {
      retired.push(entry);
    }
  }

  if (unchanged && stored) {
    if (deleted > 0) {
      await writeMirroredSpeedLimitPacks({
        bucket,
        client,
        etag: stored.etag,
        manifest: { ...stored.manifest, retired },
      });
    }
    return { build: published.build, changed: false, copied: 0, deleted };
  }

  let copied = 0;
  for (const file of files) {
    if (await isStored({ bucket, client, ...file })) {
      continue;
    }
    await copyFile({
      bucket,
      client,
      fetchFile,
      uploadClient,
      url: new URL(file.path, manifestUrl).toString(),
      ...file,
    });
    copied += 1;
  }

  const retiredAt = new Date(now()).toISOString();
  const previousKeys = stored
    ? [stored.manifest.boundaries.key, ...stored.manifest.regions.map(({ key }) => key)]
    : [];
  for (const key of previousKeys) {
    if (!liveKeys.has(key) && !retired.some((entry) => entry.key === key)) {
      retired.push({ key, retiredAt });
    }
  }

  await writeMirroredSpeedLimitPacks({
    bucket,
    client,
    etag: stored?.etag ?? null,
    manifest: {
      format: published.format,
      build: published.build,
      publishedAt: published.publishedAt,
      mirroredAt: retiredAt,
      license: published.license,
      licenseUrl: published.licenseUrl,
      attribution: published.attribution,
      boundaries: { key: boundaries.key, sha256: boundaries.sha256, size: boundaries.size },
      regions: regions.map(({ bounds, countryCode, id, key, name, sha256, size }) => ({
        bounds,
        countryCode,
        id,
        key,
        name,
        sha256,
        size,
      })),
      retired,
    },
  });

  return { build: published.build, changed: true, copied, deleted };
};

export const scheduleSpeedLimitMirror = ({
  intervalMs = 24 * 60 * 60 * 1000,
  mirror,
}: {
  intervalMs?: number;
  mirror: () => ReturnType<typeof mirrorSpeedLimitPacks>;
}) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let failures = 0;

  const run = async () => {
    const result = await tryCatch(mirror());

    if (stopped) {
      return;
    }
    if (result.error) {
      failures += 1;
      console.error(`Speed limit pack mirror failed: ${result.error.message}`);
    } else {
      failures = 0;
      console.log(
        result.data.changed
          ? `Speed limit packs ${result.data.build} are live (${result.data.copied} files copied)`
          : `Speed limit packs ${result.data.build} are up to date`,
      );
    }
    const delay = failures > 0 ? Math.min(3_600_000 * 2 ** (failures - 1), intervalMs) : intervalMs;
    timer = setTimeout(() => void run(), delay);
  };

  void run();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
};
