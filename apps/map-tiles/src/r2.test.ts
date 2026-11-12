import { describe, expect, mock, test } from "bun:test";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { checkBucketAccess } from "./r2.ts";

describe("checkBucketAccess", () => {
  test("lists, writes and deletes a small object", async () => {
    const send = mock(async (_command: unknown, _options: unknown) => ({}));

    await checkBucketAccess({ bucket: "maps", client: { send } as unknown as S3Client });

    const commands = send.mock.calls.map(([command]) => command);
    expect(commands[0]).toBeInstanceOf(ListObjectsV2Command);
    expect(commands[1]).toBeInstanceOf(PutObjectCommand);
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[1] as PutObjectCommand).input).toMatchObject({
      Bucket: "maps",
      Key: "map-tiles-access-check",
    });
    expect((commands[2] as DeleteObjectCommand).input).toEqual({
      Bucket: "maps",
      Key: "map-tiles-access-check",
    });
  });

  test("fails when the credentials can only read", async () => {
    const send = mock(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        throw Object.assign(new Error("Access Denied"), { name: "AccessDenied" });
      }
      return {};
    });

    await expect(
      checkBucketAccess({ bucket: "maps", client: { send } as unknown as S3Client }),
    ).rejects.toThrow("Access Denied");
  });
});
