import { afterAll, describe, expect, mock, test } from "bun:test";
import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";

const s3Send = mock(async (_command: unknown, _options: unknown) => ({}));
const r2Client = { send: mock(async () => ({})) };
const checkMapArchive = mock(async (_input: unknown) => {});

mock.module("./s3client.ts", () => ({ s3Client: { send: s3Send } }));
mock.module("./r2.ts", () => ({ r2Client }));
const mapTiles = await import("@openbeacon/map-tiles");
mock.module("@openbeacon/map-tiles", () => ({ ...mapTiles, checkMapArchive }));

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

  test("checks the map archive in the configured R2 bucket", async () => {
    await checkR2();
    expect(checkMapArchive).toHaveBeenLastCalledWith({ bucket: env.R2_BUCKET, client: r2Client });
  });

  test("propagates storage failures", async () => {
    s3Send.mockRejectedValueOnce(new Error("S3 unavailable"));
    checkMapArchive.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(checkS3()).rejects.toThrow("S3 unavailable");
    await expect(checkR2()).rejects.toThrow("R2 unavailable");
  });
});
