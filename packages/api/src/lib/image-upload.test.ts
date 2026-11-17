import { afterEach, expect, spyOn, test } from "bun:test";
import {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import type { PrismaClient } from "@openbeacon/database";
import { MIN_ENCRYPTED_IMAGE_LENGTH } from "@openbeacon/encryption";
import { env } from "../env.ts";
import { s3Client } from "../s3client.ts";
import { buildGroupAvatarPath, buildUserAvatarPath, confirmImageUpload } from "./image-upload.ts";

const send = spyOn(s3Client, "send");
afterEach(() => send.mockReset());

const storeObject = (size: number, contentType: string) => {
  const deleted: string[] = [];
  send.mockImplementation((async (command: unknown) => {
    if (command instanceof HeadObjectCommand)
      return { ContentLength: size, ContentType: contentType };
    if (command instanceof ListObjectVersionsCommand)
      return { Versions: [{ Key: command.input.Prefix, VersionId: "1" }] };
    if (command instanceof DeleteObjectsCommand) {
      deleted.push(...(command.input.Delete?.Objects ?? []).map(({ Key }) => Key ?? ""));
      return {};
    }
    throw new Error("Unexpected storage call");
  }) as unknown as typeof s3Client.send);
  return deleted;
};
const confirm = () => {
  const committed: string[] = [];
  const pendingDeletes: unknown[] = [];
  const result = confirmImageUpload({
    db: {
      pendingUpload: { deleteMany: async (args: unknown) => pendingDeletes.push(args) },
    } as unknown as PrismaClient,
    userId: "user-1",
    uploadType: "userAvatar",
    bucketName: "bucket",
    imagePath: buildUserAvatarPath("user-1"),
    pendingFileName: "upload",
    currentImageUrl: null,
    noPendingImageUploadMessage: "No upload",
    commitImageUpload: async (imageUrl) => {
      committed.push(imageUrl);
      return null;
    },
  });
  return { committed, pendingDeletes, result };
};

test("image upload paths belong to the uploader", () => {
  const userId = "user-1";
  expect(buildUserAvatarPath(userId)).toBe("user/user-1/uploads/avatar");
  expect(buildGroupAvatarPath(userId, "group-1")).toBe("user/user-1/uploads/group/group-1/avatar");
  expect(buildGroupAvatarPath("user-2", "group-1")).not.toBe(
    buildGroupAvatarPath(userId, "group-1"),
  );
});

for (const size of [MIN_ENCRYPTED_IMAGE_LENGTH, env.MAX_IMAGE_FILE_SIZE]) {
  test(`confirming accepts an encrypted file of ${size} bytes`, async () => {
    const deleted = storeObject(size, "application/octet-stream");
    const { committed, result } = confirm();
    expect((await result).imageUrl).toEndWith("/user/user-1/uploads/avatar/upload");
    expect(committed).toHaveLength(1);
    expect(deleted).toEqual([]);
  });
}

for (const [name, size, contentType] of [
  [
    "a file shorter than an encrypted header and tag",
    MIN_ENCRYPTED_IMAGE_LENGTH - 1,
    "application/octet-stream",
  ],
  ["an empty file", 0, "application/octet-stream"],
  ["a file over the size limit", env.MAX_IMAGE_FILE_SIZE + 1, "application/octet-stream"],
  ["a file stored as HTML", 100, "text/html"],
  [
    "a file stored with an image content type instead of application/octet-stream",
    100,
    "image/webp",
  ],
] as const) {
  test(`confirming rejects and deletes ${name}`, async () => {
    const deleted = storeObject(size, contentType);
    const { committed, pendingDeletes, result } = confirm();
    await expect(result).rejects.toThrow("Uploaded failed verification.");
    expect(committed).toEqual([]);
    expect(deleted).toEqual(["user/user-1/uploads/avatar/upload"]);
    expect(pendingDeletes).toHaveLength(1);
  });
}
