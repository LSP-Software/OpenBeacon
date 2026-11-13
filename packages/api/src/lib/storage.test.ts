import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  type DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { s3Client } from "../s3client.ts";
import { deleteFile, deleteUserImages, getPresignedUploadUrl, getUploadedFile } from "./storage.ts";

const send = spyOn(s3Client, "send");
afterEach(() => send.mockReset());

describe("deleteFile", () => {
  test("deletes every matching version across pages", async () => {
    send.mockResolvedValueOnce({
      $metadata: {},
      Versions: [{ Key: "path/image", VersionId: "1" }],
      IsTruncated: true,
      NextKeyMarker: "path/image",
      NextVersionIdMarker: "1",
    });
    send.mockResolvedValueOnce({
      $metadata: {},
      DeleteMarkers: [{ Key: "path/image", VersionId: "2" }],
      Versions: [{ Key: "path/image-other", VersionId: "3" }],
    });
    send.mockResolvedValueOnce({ $metadata: {} });
    await deleteFile("bucket", "path", "image");
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(ListObjectVersionsCommand);
    expect(
      (send.mock.calls[1]?.[0] as ListObjectVersionsCommand | undefined)?.input.VersionIdMarker,
    ).toBe("1");
    expect(
      (send.mock.calls[2]?.[0] as DeleteObjectsCommand | undefined)?.input.Delete?.Objects,
    ).toEqual([
      { Key: "path/image", VersionId: "1" },
      { Key: "path/image", VersionId: "2" },
    ]);
  });
  test("fails when storage reports an undeleted version", async () => {
    send.mockResolvedValueOnce({
      $metadata: {},
      Versions: [{ Key: "path/image", VersionId: "1" }],
    });
    send.mockResolvedValueOnce({
      $metadata: {},
      Errors: [{ Key: "path/image", Code: "AccessDenied" }],
    });
    await expect(deleteFile("bucket", "path", "image")).rejects.toThrow(
      "Failed to delete all image versions",
    );
  });
  test("fails when version listing fails", async () => {
    send.mockRejectedValueOnce(new Error("AccessDenied"));
    await expect(deleteFile("bucket", "path", "image")).rejects.toThrow("AccessDenied");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("deleteUserImages", () => {
  test("deletes all user image versions and delete markers across pages", async () => {
    send.mockResolvedValueOnce({
      $metadata: {},
      Versions: [{ Key: "user/a/uploads/avatar/one", VersionId: "1" }],
      IsTruncated: true,
      NextKeyMarker: "user/a/uploads/avatar/one",
      NextVersionIdMarker: "1",
    });
    send.mockResolvedValueOnce({
      $metadata: {},
      DeleteMarkers: [{ Key: "user/a/uploads/group/g/avatar/two", VersionId: "2" }],
    });
    send.mockResolvedValueOnce({ $metadata: {} });
    await deleteUserImages("bucket", "a");
    expect((send.mock.calls[0]?.[0] as ListObjectVersionsCommand | undefined)?.input.Prefix).toBe(
      "user/a/",
    );
    expect(
      (send.mock.calls[1]?.[0] as ListObjectVersionsCommand | undefined)?.input.VersionIdMarker,
    ).toBe("1");
    expect(
      (send.mock.calls[2]?.[0] as DeleteObjectsCommand | undefined)?.input.Delete?.Objects,
    ).toEqual([
      { Key: "user/a/uploads/avatar/one", VersionId: "1" },
      { Key: "user/a/uploads/group/g/avatar/two", VersionId: "2" },
    ]);
  });

  test("rejects invalid user IDs and objects outside the user's prefix", async () => {
    await expect(deleteUserImages("bucket", "a/b")).rejects.toThrow("Invalid user ID");
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce({
      $metadata: {},
      Versions: [{ Key: "user/another/image", VersionId: "1" }],
    });
    await expect(deleteUserImages("bucket", "a")).rejects.toThrow("invalid image version");
    expect(send).toHaveBeenCalledTimes(1);
  });

  test("reports partial storage failures for retry", async () => {
    send.mockResolvedValueOnce({
      $metadata: {},
      Versions: [{ Key: "user/a/image", VersionId: "1" }],
    });
    send.mockResolvedValueOnce({ $metadata: {}, Errors: [{ Code: "AccessDenied" }] });
    await expect(deleteUserImages("bucket", "a")).rejects.toThrow(
      "Failed to delete all image versions",
    );
  });
});

describe("getPresignedUploadUrl", () => {
  test("signs the content type so the upload can't choose another one", async () => {
    const url = new URL(
      await getPresignedUploadUrl("bucket", "path", "image.webp", "image/webp", "aGFzaA==", 10),
    );
    expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
      expect.arrayContaining(["content-type", "x-amz-checksum-sha256"]),
    );
  });
});

describe("getUploadedFile", () => {
  test("doesn't read an upload that is already over the size limit", async () => {
    send.mockResolvedValueOnce({
      $metadata: {},
      ContentLength: 50_000_000,
      ContentType: "image/webp",
    });

    const file = await getUploadedFile("bucket", "path", "image.webp", 16, 5_242_880);

    expect(file?.header).toEqual(new Uint8Array());
    expect(send.mock.calls.some(([command]) => command instanceof GetObjectCommand)).toBe(false);
  });
});
