import { afterAll, describe, expect, mock, test } from "bun:test";
import { HeadObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import type { MapTilesManifest } from "@openbeacon/map-tiles";

const s3Send = mock(async (_command: unknown, _options: unknown) => ({}));
const r2Send = mock(async (_command: unknown, _options: unknown) => ({}));

mock.module("./s3client.ts", () => ({ s3Client: { send: s3Send } }));
const manifest: MapTilesManifest = {
  current: "b",
  slots: {
    a: null,
    b: {
      build: "20261101",
      key: "planet-b.pmtiles",
      publishedAt: "2026-11-01T00:00:00.000Z",
      schemaVersion: "4.15.2",
      size: 1,
    },
  },
};
const readManifest = mock(
  async (_input: unknown): Promise<{ manifest: MapTilesManifest } | null> => ({
    manifest,
  }),
);

mock.module("./r2.ts", () => ({ r2Client: { send: r2Send } }));
const mapTiles = await import("@openbeacon/map-tiles");
mock.module("@openbeacon/map-tiles", () => ({ ...mapTiles, readManifest }));

const { checkS3, checkR2 } = await import("./checkStorage.ts");
const { env } = await import("./env.ts");

afterAll(() => mock.restore());

describe("storage startup checks", () => {
  test("checks access to the configured S3 bucket", async () => {
    await checkS3();
    const [command, options] = s3Send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(ListObjectVersionsCommand);
    expect((command as ListObjectVersionsCommand).input).toEqual({
      Bucket: env.S3_BUCKET_NAME,
      MaxKeys: 1,
    });
    expect(options).toHaveProperty("abortSignal");
  });

  test("checks the current map tiles archive", async () => {
    await checkR2();
    const [command, options] = r2Send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect((command as HeadObjectCommand).input).toEqual({
      Bucket: env.R2_BUCKET,
      Key: "planet-b.pmtiles",
    });
    expect(options).toHaveProperty("abortSignal");
  });

  test("only checks bucket access before the first map is published", async () => {
    r2Send.mockClear();
    readManifest.mockResolvedValueOnce(null);
    await checkR2();
    expect(readManifest).toHaveBeenLastCalledWith({
      bucket: env.R2_BUCKET,
      client: { send: r2Send },
    });
    expect(r2Send).not.toHaveBeenCalled();
  });

  test("propagates storage failures", async () => {
    s3Send.mockRejectedValueOnce(new Error("S3 unavailable"));
    r2Send.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(checkS3()).rejects.toThrow("S3 unavailable");
    await expect(checkR2()).rejects.toThrow("R2 unavailable");
    readManifest.mockRejectedValueOnce(new Error("Bucket unavailable"));
    await expect(checkR2()).rejects.toThrow("Bucket unavailable");
  });
});
