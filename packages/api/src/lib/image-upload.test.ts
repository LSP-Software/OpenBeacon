import { afterEach, expect, spyOn, test } from "bun:test";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import type { PrismaClient } from "@openbeacon/database";
import { s3Client } from "../s3client.ts";
import {
  buildGroupAvatarPath,
  buildUserAvatarPath,
  confirmImageUpload,
  isWebpFile,
} from "./image-upload.ts";

const webp = Uint8Array.from(atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), (char) =>
  char.charCodeAt(0),
);
const html = new TextEncoder().encode("<!doctype html><script>alert(1)</script>");
const send = spyOn(s3Client, "send");
afterEach(() => send.mockReset());

const storeObject = (bytes: Uint8Array, contentType: string) => {
  const deleted: string[] = [];
  send.mockImplementation((async (command: unknown) => {
    if (command instanceof HeadObjectCommand)
      return { ContentLength: bytes.length, ContentType: contentType };
    if (command instanceof GetObjectCommand) {
      const [, end] = /bytes=0-(\d+)/.exec(command.input.Range ?? "") ?? [];
      return {
        Body: { transformToByteArray: async () => bytes.slice(0, Number(end) + 1) },
      };
    }
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
    pendingFileName: "upload.webp",
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

test("a WebP header must match the stored object", () => {
  expect(isWebpFile(webp.slice(0, 16), webp.length)).toBe(true);
  expect(isWebpFile(html.slice(0, 16), html.length)).toBe(false);
  expect(isWebpFile(webp.slice(0, 16), webp.length + 100)).toBe(false);
  expect(isWebpFile(webp.slice(0, 12), webp.length)).toBe(false);
  const otherChunk = webp.slice(0, 16);
  otherChunk.set(new TextEncoder().encode("VP9 "), 12);
  expect(isWebpFile(otherChunk, webp.length)).toBe(false);
});

test("confirming an upload stores a real WebP", async () => {
  const deleted = storeObject(webp, "image/webp");
  const { committed, result } = confirm();
  expect((await result).imageUrl).toEndWith("/user/user-1/uploads/avatar/upload.webp");
  expect(committed).toHaveLength(1);
  expect(deleted).toEqual([]);
});

for (const [name, bytes, contentType] of [
  ["HTML sent as HTML", html, "text/html"],
  ["HTML sent as WebP", html, "image/webp"],
  ["a WebP stored with another type", webp, "text/html"],
] as const) {
  test(`confirming rejects and deletes ${name}`, async () => {
    const deleted = storeObject(bytes, contentType);
    const { committed, pendingDeletes, result } = confirm();
    await expect(result).rejects.toThrow("Uploaded failed verification.");
    expect(committed).toEqual([]);
    expect(deleted).toEqual(["user/user-1/uploads/avatar/upload.webp"]);
    expect(pendingDeletes).toHaveLength(1);
  });
}
