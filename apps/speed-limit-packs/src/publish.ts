import { createReadStream } from "node:fs";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  SPEED_LIMIT_PACKS_PREFIX,
  type SpeedLimitPackManifest,
  speedLimitPackManifestSchema,
} from "@openbeacon/map-tiles";
import { tryCatch } from "@openbeacon/shared";
import { z } from "zod";

const GEOFABRIK_INDEX_URL = "https://download.geofabrik.de/index-v1.json";
const USER_AGENT = "openbeacon-speed-limit-packs/1 (+https://openbeacon.net)";
const MANIFEST_KEY = `${SPEED_LIMIT_PACKS_PREFIX}manifest.json`;

const continentSchema = z.object({
  continent: z.string().min(1),
  build: z.number().int(),
  regions: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      countryCode: z.string().min(1),
      file: z.string().min(1),
      size: z.number().int().positive(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      bounds: z.array(z.number()).length(4),
    }),
  ),
});

type Continent = z.infer<typeof continentSchema>;

const geofabrikIndexSchema = z.object({
  features: z.array(
    z.object({
      properties: z.object({ id: z.string() }),
      geometry: z.object({ type: z.string(), coordinates: z.array(z.unknown()) }),
    }),
  ),
});

const getPackPath = ({ id, sha256 }: { id: string; sha256: string }) =>
  `packs/${id}-${sha256.slice(0, 16)}.obsl`;

export const buildManifest = ({
  boundaries,
  build,
  continents,
  publishedAt,
}: {
  boundaries: { path: string; size: number; sha256: string };
  build: string;
  continents: Continent[];
  publishedAt: string;
}): SpeedLimitPackManifest => {
  const stale = continents.find((continent) => String(continent.build) !== build);

  if (stale) {
    throw new Error(`${stale.continent} was built for ${stale.build}, not ${build}`);
  }

  return speedLimitPackManifestSchema.parse({
    format: 1,
    build,
    publishedAt,
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution:
      "© OpenStreetMap contributors, available under the Open Database License (https://www.openstreetmap.org/copyright). Default speed limits from osm-legal-default-speeds, based on the OpenStreetMap wiki (CC BY-SA 2.0).",
    boundaries,
    regions: continents.flatMap(({ regions }) =>
      regions.map(({ bounds, countryCode, id, name, sha256, size }) => ({
        bounds,
        countryCode,
        id,
        name,
        path: getPackPath({ id, sha256 }),
        sha256,
        size,
      })),
    ),
  });
};

export const buildBoundaries = ({
  index,
  regionIds,
}: {
  index: z.infer<typeof geofabrikIndexSchema>;
  regionIds: string[];
}) => {
  const round = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(round)
      : typeof value === "number"
        ? Math.round(value * 10_000) / 10_000
        : value;

  return {
    format: 1,
    regions: regionIds.map((id) => {
      const feature = index.features.find(({ properties }) => properties.id === id);

      if (!feature) {
        throw new Error(`Geofabrik has no outline for ${id}`);
      }

      return {
        id,
        geometry: { type: feature.geometry.type, coordinates: round(feature.geometry.coordinates) },
      };
    }),
  };
};

export const findUnusedKeys = ({
  keys,
  manifests,
}: {
  keys: string[];
  manifests: { boundaries: { path: string }; regions: { path: string }[] }[];
}) => {
  const used = new Set([
    MANIFEST_KEY,
    ...manifests.flatMap(({ boundaries, regions }) =>
      [boundaries, ...regions].map(({ path }) => `${SPEED_LIMIT_PACKS_PREFIX}${path}`),
    ),
  ]);

  return keys.filter((key) => !used.has(key));
};

const createClient = () => {
  const env = z
    .object({
      SPEED_LIMIT_PACKS_S3_ENDPOINT: z.url(),
      SPEED_LIMIT_PACKS_S3_REGION: z.string().min(1),
      SPEED_LIMIT_PACKS_S3_ACCESS_KEY_ID: z.string().min(1),
      SPEED_LIMIT_PACKS_S3_ACCESS_KEY: z.string().min(1),
      SPEED_LIMIT_PACKS_S3_BUCKET_NAME: z.string().min(1),
    })
    .parse(process.env);

  return {
    bucket: env.SPEED_LIMIT_PACKS_S3_BUCKET_NAME,
    client: new S3Client({
      endpoint: env.SPEED_LIMIT_PACKS_S3_ENDPOINT,
      region: env.SPEED_LIMIT_PACKS_S3_REGION,
      credentials: {
        accessKeyId: env.SPEED_LIMIT_PACKS_S3_ACCESS_KEY_ID,
        secretAccessKey: env.SPEED_LIMIT_PACKS_S3_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
};

const uploadPacks = async (outDir: string) => {
  const { bucket, client } = createClient();
  const continent = continentSchema.parse(await Bun.file(join(outDir, "regions.json")).json());

  for (const region of continent.regions) {
    const key = `${SPEED_LIMIT_PACKS_PREFIX}${getPackPath(region)}`;
    const existing = await tryCatch(
      client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })),
    );

    if (!existing.error && existing.data.ContentLength === region.size) {
      console.log(`${region.id} is already published`);
      continue;
    }

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: createReadStream(join(outDir, region.file)),
        ContentLength: region.size,
        ContentType: "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    console.log(`Uploaded ${region.id} (${Math.round(region.size / 1_048_576)} MiB)`);
  }
};

const publishManifest = async ({ build, files }: { build: string; files: string[] }) => {
  const { bucket, client } = createClient();
  const continents = await Promise.all(
    files.map(async (file) => continentSchema.parse(await Bun.file(file).json())),
  );
  const response = await fetch(GEOFABRIK_INDEX_URL, { headers: { "User-Agent": USER_AGENT } });

  if (!response.ok) {
    throw new Error(`Could not read the Geofabrik index: HTTP ${response.status}`);
  }

  const boundariesBody = JSON.stringify(
    buildBoundaries({
      index: geofabrikIndexSchema.parse(await response.json()),
      regionIds: continents.flatMap(({ regions }) => regions.map(({ id }) => id)),
    }),
  );
  const boundariesSha = new Bun.CryptoHasher("sha256").update(boundariesBody).digest("hex");
  const boundaries = {
    path: `boundaries-${boundariesSha.slice(0, 16)}.json`,
    size: Buffer.byteLength(boundariesBody),
    sha256: boundariesSha,
  };
  const manifest = buildManifest({
    boundaries,
    build,
    continents,
    publishedAt: new Date().toISOString(),
  });

  for (const region of manifest.regions) {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: `${SPEED_LIMIT_PACKS_PREFIX}${region.path}` }),
    );
    if (head.ContentLength !== region.size) {
      throw new Error(`${region.path} is missing or the wrong size in the bucket`);
    }
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `${SPEED_LIMIT_PACKS_PREFIX}${boundaries.path}`,
      Body: boundariesBody,
      ContentType: "application/json",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const replaced = await tryCatch(
    client
      .send(new GetObjectCommand({ Bucket: bucket, Key: MANIFEST_KEY }))
      .then(async (result) =>
        speedLimitPackManifestSchema.parse(
          JSON.parse((await result.Body?.transformToString()) ?? ""),
        ),
      ),
  );

  if (replaced.error && replaced.error.name !== "NoSuchKey") {
    throw replaced.error;
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: MANIFEST_KEY,
      Body: `${JSON.stringify(manifest, null, 2)}\n`,
      ContentType: "application/json",
      CacheControl: "public, max-age=300",
    }),
  );
  console.log(`Published speed limit packs ${build}: ${manifest.regions.length} regions`);

  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: SPEED_LIMIT_PACKS_PREFIX,
        ContinuationToken: token,
      }),
    );
    keys.push(...(page.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  for (const key of findUnusedKeys({
    keys,
    manifests: replaced.data ? [manifest, replaced.data] : [manifest],
  })) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`Deleted ${key}`);
  }
};

const run = async () => {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "upload" && rest[0]) {
    return uploadPacks(rest[0]);
  }
  if (command === "manifest" && rest[0] === "--build" && rest[1] && rest.length > 2) {
    return publishManifest({ build: rest[1], files: rest.slice(2) });
  }

  throw new Error(
    "Usage: publish.ts upload <out-dir> | publish.ts manifest --build <yyyymmdd> <regions.json>...",
  );
};

if (import.meta.main) {
  const result = await tryCatch(run());

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
}
