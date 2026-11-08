import { afterAll, describe, expect, mock, test } from "bun:test";
import { HeadObjectCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";

const s3Send = mock(async (_command: unknown, _options: unknown) => ({}));
const r2Send = mock(async (_command: unknown, _options: unknown) => ({}));

mock.module("./s3client.ts", () => ({ s3Client: { send: s3Send } }));
const resolvePmtilesArchiveKey = mock(
  async (_requestedKey: string | undefined) => "planet-current.pmtiles",
);

mock.module("./r2.ts", () => ({ r2Client: { send: r2Send }, resolvePmtilesArchiveKey }));

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
    expect(resolvePmtilesArchiveKey).toHaveBeenCalledWith(undefined);
    const [command, options] = r2Send.mock.calls[0] ?? [];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect((command as HeadObjectCommand).input).toEqual({
      Bucket: env.R2_BUCKET,
      Key: "planet-current.pmtiles",
    });
    expect(options).toHaveProperty("abortSignal");
  });

  test("propagates storage failures", async () => {
    s3Send.mockRejectedValueOnce(new Error("S3 unavailable"));
    r2Send.mockRejectedValueOnce(new Error("R2 unavailable"));
    await expect(checkS3()).rejects.toThrow("S3 unavailable");
    await expect(checkR2()).rejects.toThrow("R2 unavailable");
  });
});
