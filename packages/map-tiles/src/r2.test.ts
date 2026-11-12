import { describe, expect, mock, test } from "bun:test";
import { GetObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { MapTilesManifest } from "./manifest.ts";
import { checkMapArchive } from "./r2.ts";

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

const createClient = ({
  head = async () => ({}),
  stored,
}: {
  head?: () => Promise<unknown>;
  stored: MapTilesManifest | null;
}) => {
  const send = mock(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      if (!stored) {
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      }
      return {
        Body: { transformToString: async () => JSON.stringify(stored) },
        ETag: '"etag"',
      };
    }
    return head();
  });
  return { client: { send } as unknown as S3Client, send };
};

describe("checkMapArchive", () => {
  test("checks the archive in use exists", async () => {
    const { client, send } = createClient({ stored: manifest });
    await checkMapArchive({ bucket: "bucket", client });
    const [command] = send.mock.calls[1] ?? [];
    expect(command).toBeInstanceOf(HeadObjectCommand);
    expect((command as HeadObjectCommand).input).toEqual({
      Bucket: "bucket",
      Key: "planet-b.pmtiles",
    });
  });

  test("only reads the bucket before the first map is published", async () => {
    const { client, send } = createClient({ stored: null });
    await checkMapArchive({ bucket: "bucket", client });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("fails when the archive in use is missing", async () => {
    const { client } = createClient({
      head: async () => {
        throw new Error("NotFound");
      },
      stored: manifest,
    });
    await expect(checkMapArchive({ bucket: "bucket", client })).rejects.toThrow("NotFound");
  });
});
