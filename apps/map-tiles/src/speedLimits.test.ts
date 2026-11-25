import { describe, expect, test } from "bun:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import {
  getMirroredPackKey,
  type MirroredSpeedLimitPacks,
  SPEED_LIMIT_PACKS_MANIFEST_KEY,
  type SpeedLimitPackManifest,
} from "@openbeacon/map-tiles";
import { mirrorSpeedLimitPacks } from "./speedLimits.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const manifestUrl = "https://cdn.example.org/speed-limits/manifest.json";

const sha256 = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

const createBucket = () => {
  const objects = new Map<string, { body: string; sha256?: string }>();
  const log: string[] = [];
  let failPutsAfter = Infinity;

  const notFound = (name: string) => Object.assign(new Error(name), { name });

  const send = async (command: unknown) => {
    if (command instanceof HeadObjectCommand) {
      const object = objects.get(command.input.Key ?? "");
      if (!object) throw notFound("NotFound");
      return {
        ContentLength: Buffer.byteLength(object.body),
        Metadata: object.sha256 ? { sha256: object.sha256 } : {},
      };
    }
    if (command instanceof GetObjectCommand) {
      const object = objects.get(command.input.Key ?? "");
      if (!object) throw notFound("NoSuchKey");
      return {
        Body: { transformToString: async () => object.body },
        ETag: `"${sha256(object.body)}"`,
      };
    }
    if (command instanceof PutObjectCommand) {
      if (failPutsAfter-- <= 0) {
        throw new Error("connection reset");
      }
      const body = command.input.Body;
      let text = "";
      if (typeof body === "string") {
        text = body;
      } else {
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          text += Buffer.from(chunk).toString();
        }
      }
      objects.set(command.input.Key ?? "", {
        body: text,
        sha256: command.input.Metadata?.["sha256"],
      });
      log.push(`put ${command.input.Key}`);
      return { ETag: `"${sha256(text)}"` };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(command.input.Key ?? "");
      log.push(`delete ${command.input.Key}`);
      return {};
    }
    throw new Error("Unexpected command");
  };

  return {
    client: { send } as unknown as S3Client,
    failPutsAfter: (count: number) => {
      failPutsAfter = count;
    },
    log,
    objects,
    stored: () => {
      const manifest = objects.get(SPEED_LIMIT_PACKS_MANIFEST_KEY);
      return manifest ? (JSON.parse(manifest.body) as MirroredSpeedLimitPacks) : null;
    },
  };
};

const createCdn = (build: string, files: Record<string, string>) => {
  const fileEntry = (path: string) => ({
    path,
    size: Buffer.byteLength(files[path] ?? ""),
    sha256: sha256(files[path] ?? ""),
  });
  const regionIds = Object.keys(files).filter((path) => path.endsWith(".obsl"));
  const manifest: SpeedLimitPackManifest = {
    format: 1,
    build,
    publishedAt: "2026-12-02T03:00:00.000Z",
    license: "ODbL-1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "© OpenStreetMap contributors",
    boundaries: fileEntry("boundaries.json"),
    regions: regionIds.map((path) => ({
      ...fileEntry(path),
      id: path.replace(/^packs\//, "").replace(/-[0-9a-f]+\.obsl$/, ""),
      name: path,
      countryCode: "GB",
      bounds: [-8, 49, 2, 61] as [number, number, number, number],
    })),
  };
  const requested: string[] = [];
  const fetchFile = async (url: string) => {
    requested.push(url);
    if (url === manifestUrl) {
      return Response.json(manifest);
    }
    const path = url.replace("https://cdn.example.org/speed-limits/", "");
    const body = files[path];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(body);
  };
  return { fetchFile, manifest, requested };
};

const january = createCdn("20270101", {
  "boundaries.json": '{"regions":"january"}',
  "packs/united-kingdom-aaaa.obsl": "uk january",
  "packs/ireland-bbbb.obsl": "ireland january",
});

const february = createCdn("20270201", {
  "boundaries.json": '{"regions":"february"}',
  "packs/united-kingdom-cccc.obsl": "uk february",
  "packs/ireland-bbbb.obsl": "ireland january",
});

const mirror = (
  bucket: ReturnType<typeof createBucket>,
  cdn: ReturnType<typeof createCdn>,
  now: number,
) =>
  mirrorSpeedLimitPacks({
    bucket: "maps",
    client: bucket.client,
    fetchFile: cdn.fetchFile,
    manifestUrl,
    now: () => now,
    uploadClient: bucket.client,
  });

describe("mirrorSpeedLimitPacks", () => {
  test("mirrors every region and the boundaries, then writes the manifest last", async () => {
    const bucket = createBucket();

    await mirror(bucket, january, Date.parse("2027-01-02T00:00:00Z"));

    const ukKey = getMirroredPackKey({ id: "united-kingdom", sha256: sha256("uk january") });
    const irelandKey = getMirroredPackKey({ id: "ireland", sha256: sha256("ireland january") });
    expect(bucket.objects.get(ukKey)?.body).toBe("uk january");
    expect(bucket.objects.get(irelandKey)?.body).toBe("ireland january");
    expect(bucket.log.at(-1)).toBe(`put ${SPEED_LIMIT_PACKS_MANIFEST_KEY}`);
    expect(bucket.log).toHaveLength(4);

    const stored = bucket.stored();
    expect(stored?.build).toBe("20270101");
    expect(stored?.attribution).toBe("© OpenStreetMap contributors");
    expect(stored?.regions.map(({ id, key }) => [id, key])).toEqual([
      ["united-kingdom", ukKey],
      ["ireland", irelandKey],
    ]);
    expect(bucket.objects.get(stored?.boundaries.key ?? "")?.body).toBe('{"regions":"january"}');
  });

  test("does nothing more when the public manifest hasn't changed", async () => {
    const bucket = createBucket();
    await mirror(bucket, january, Date.parse("2027-01-02T00:00:00Z"));
    const before = bucket.log.length;

    const result = await mirror(bucket, january, Date.parse("2027-01-03T00:00:00Z"));

    expect(result.changed).toBe(false);
    expect(bucket.log).toHaveLength(before);
  });

  test("keeps the previous files until the new manifest is live, then for a day", async () => {
    const bucket = createBucket();
    await mirror(bucket, january, Date.parse("2027-01-02T00:00:00Z"));
    const oldUkKey = getMirroredPackKey({ id: "united-kingdom", sha256: sha256("uk january") });
    const oldBoundariesKey = bucket.stored()?.boundaries.key ?? "";
    bucket.log.length = 0;

    const switchedAt = Date.parse("2027-02-02T00:00:00Z");
    await mirror(bucket, february, switchedAt);

    expect(bucket.log.some((entry) => entry.startsWith("delete"))).toBe(false);
    expect(bucket.objects.has(oldUkKey)).toBe(true);
    expect(bucket.stored()?.build).toBe("20270201");
    expect(
      bucket
        .stored()
        ?.retired.map(({ key }) => key)
        .sort(),
    ).toEqual([oldBoundariesKey, oldUkKey].sort());
    expect(bucket.log.filter((entry) => entry.includes("ireland"))).toEqual([]);

    await mirror(bucket, february, switchedAt + DAY_MS - 1);
    expect(bucket.objects.has(oldUkKey)).toBe(true);

    await mirror(bucket, february, switchedAt + DAY_MS);
    expect(bucket.objects.has(oldUkKey)).toBe(false);
    expect(bucket.objects.has(oldBoundariesKey)).toBe(false);
    expect(bucket.stored()?.retired).toEqual([]);
    expect(
      bucket.objects.has(getMirroredPackKey({ id: "ireland", sha256: sha256("ireland january") })),
    ).toBe(true);
  });

  test("a mirror that stops part-way leaves the old manifest live and resumes without re-uploading", async () => {
    const bucket = createBucket();
    await mirror(bucket, january, Date.parse("2027-01-02T00:00:00Z"));
    bucket.failPutsAfter(1);

    await expect(mirror(bucket, february, Date.parse("2027-02-02T00:00:00Z"))).rejects.toThrow(
      "connection reset",
    );
    expect(bucket.stored()?.build).toBe("20270101");

    bucket.failPutsAfter(Infinity);
    bucket.log.length = 0;
    await mirror(bucket, february, Date.parse("2027-02-02T01:00:00Z"));

    expect(bucket.stored()?.build).toBe("20270201");
    expect(bucket.log.filter((entry) => entry.startsWith("put"))).toHaveLength(2);
  });

  test("replaces a stored file whose hash doesn't match", async () => {
    const bucket = createBucket();
    const ukKey = getMirroredPackKey({ id: "united-kingdom", sha256: sha256("uk january") });
    bucket.objects.set(ukKey, { body: "uk januarx", sha256: sha256("uk januarx") });

    await mirror(bucket, january, Date.parse("2027-01-02T00:00:00Z"));

    expect(bucket.objects.get(ukKey)?.body).toBe("uk january");
  });

  test("never makes a file live when its download doesn't match the manifest", async () => {
    const bucket = createBucket();
    const tampered = createCdn("20270101", {
      "boundaries.json": '{"regions":"january"}',
      "packs/united-kingdom-aaaa.obsl": "uk january",
    });
    const fetchFile = async (url: string) =>
      url.endsWith(".obsl") ? new Response("uk tampered") : tampered.fetchFile(url);

    await expect(
      mirrorSpeedLimitPacks({
        bucket: "maps",
        client: bucket.client,
        fetchFile,
        manifestUrl,
        now: () => Date.parse("2027-01-02T00:00:00Z"),
        uploadClient: bucket.client,
      }),
    ).rejects.toThrow("doesn't match");

    expect(bucket.stored()).toBeNull();
    expect(
      bucket.objects.has(
        getMirroredPackKey({ id: "united-kingdom", sha256: sha256("uk january") }),
      ),
    ).toBe(false);
  });

  test("rejects a public manifest that fails validation", async () => {
    const bucket = createBucket();

    await expect(
      mirrorSpeedLimitPacks({
        bucket: "maps",
        client: bucket.client,
        fetchFile: async () => Response.json({ format: 1, regions: [] }),
        manifestUrl,
        now: () => 0,
        uploadClient: bucket.client,
      }),
    ).rejects.toThrow();
    expect(bucket.log).toEqual([]);
  });
});
