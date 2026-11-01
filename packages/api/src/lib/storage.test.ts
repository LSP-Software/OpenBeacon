import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { DeleteObjectsCommand, ListObjectVersionsCommand } from "@aws-sdk/client-s3";
import { s3Client } from "../s3client.ts";
import { deleteFile } from "./storage.ts";

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
