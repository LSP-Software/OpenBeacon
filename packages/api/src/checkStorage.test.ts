import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { ListObjectVersionsCommand } from "@aws-sdk/client-s3";

const s3Send = mock(async (_command: unknown, _options: unknown) => ({}));
const mapStorageClient = { send: mock(async () => ({})) };
const checkMapArchive = mock(async (_input: unknown) => {});

mock.module("./s3client.ts", () => ({ s3Client: { send: s3Send } }));
mock.module("./mapStorage.ts", () => ({ mapStorageClient }));
const mapTiles = await import("@openbeacon/map-tiles");
mock.module("@openbeacon/map-tiles", () => ({ ...mapTiles, checkMapArchive }));

const { checkImageStorage, checkMapStorage } = await import("./checkStorage.ts");
const { env } = await import("./env.ts");

afterAll(() => mock.restore());

describe("storage startup checks", () => {
  test("checks access to the configured S3 bucket", async () => {
    await checkImageStorage();
    const [command, options] = s3Send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(ListObjectVersionsCommand);
    expect((command as ListObjectVersionsCommand).input).toEqual({
      Bucket: env.IMAGES_S3_BUCKET_NAME,
      MaxKeys: 1,
    });
    expect(options).toHaveProperty("abortSignal");
  });

  test("checks the map archive in the configured map bucket", async () => {
    await checkMapStorage();
    expect(checkMapArchive).toHaveBeenLastCalledWith({
      bucket: env.MAP_S3_BUCKET_NAME,
      client: mapStorageClient,
    });
  });

  test("propagates storage failures", async () => {
    s3Send.mockRejectedValueOnce(new Error("S3 unavailable"));
    checkMapArchive.mockRejectedValueOnce(new Error("map storage unavailable"));
    await expect(checkImageStorage()).rejects.toThrow("S3 unavailable");
    await expect(checkMapStorage()).rejects.toThrow("map storage unavailable");
  });

  test("explains likely fixes under each storage label", async () => {
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const noSuchBucket = Object.assign(new Error("The bucket does not exist"), {
      name: "NoSuchBucket",
    });
    s3Send.mockRejectedValueOnce(noSuchBucket);
    checkMapArchive.mockRejectedValueOnce(noSuchBucket);

    await expect(checkImageStorage()).rejects.toBe(noSuchBucket);
    await expect(checkMapStorage()).rejects.toBe(noSuchBucket);
    expect(consoleError.mock.calls).toEqual([
      ["  Image storage: check IMAGES_S3_BUCKET_NAME"],
      ["  Map storage: check MAP_S3_BUCKET_NAME"],
    ]);
    consoleError.mockRestore();
  });
});
