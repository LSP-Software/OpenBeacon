import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  DeleteObjectsCommand,
  type DeleteObjectsCommandInput,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";
import { env } from "@openbeacon/api/env.ts";
import { s3Client } from "@openbeacon/api/s3client.ts";
import { prisma } from "@openbeacon/database";
import { runImageStorageSweep, runStalePendingUploadCleanup } from "./imageUploadCleanup.ts";

const prefix = `image-cleanup-${crypto.randomUUID()}`;
const userId = `${prefix}-user`;
const groupId = `${prefix}-group`;
const minute = 60_000;
let databaseNow = new Date();
const ago = (ms: number) => new Date(databaseNow.getTime() - ms);
const groupKey = (fileName: string) => `user/${userId}/uploads/group/${groupId}/avatar/${fileName}`;
const avatarKey = (fileName: string) => `user/${userId}/uploads/avatar/${fileName}`;
const url = (key: string) => `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}/${key}`;

type Version = { Key: string; VersionId: string; LastModified: Date; IsLatest: boolean };
let pages: Array<{ Versions?: Version[]; DeleteMarkers?: Version[] }> = [];
let deleted: Array<{ Key?: string; VersionId?: string }> = [];
let failDeletes = false;
const send = spyOn(s3Client, "send");

const mockStorage = () => {
  send.mockImplementation((async (command: unknown) => {
    if (command instanceof ListObjectVersionsCommand) {
      if (command.input.Prefix !== "user/") {
        if (failDeletes)
          throw Object.assign(new Error(`secret ${command.input.Prefix}`), {
            name: "AccessDenied",
          });
        return {
          $metadata: {},
          Versions: [
            { Key: command.input.Prefix, VersionId: "v1", LastModified: ago(0), IsLatest: true },
          ],
        };
      }
      const index = Number(command.input.KeyMarker ?? 0);
      return {
        $metadata: {},
        ...pages[index],
        IsTruncated: index + 1 < pages.length,
        NextKeyMarker: String(index + 1),
        NextVersionIdMarker: "marker",
      };
    }
    if (command instanceof DeleteObjectsCommand) {
      const objects = (command.input as DeleteObjectsCommandInput).Delete?.Objects ?? [];
      if (failDeletes) return { $metadata: {}, Errors: [{ Key: objects[0]?.Key }] };
      deleted.push(...objects);
      return { $metadata: {} };
    }
    throw new Error("Unexpected storage command");
  }) as unknown as typeof s3Client.send);
};

const deletedKeys = () =>
  deleted
    .filter(({ Key }) => Key?.includes(prefix))
    .map(({ Key, VersionId }) => `${Key?.slice(Key.lastIndexOf("/") + 1)}@${VersionId}`)
    .sort();

const pendingFileNames = async () =>
  (await prisma.pendingUpload.findMany({ where: { userId }, orderBy: { fileName: "asc" } })).map(
    ({ fileName }) => fileName,
  );

describe.skipIf(process.env["OPENBEACON_INTEGRATION"] !== "1")("Image upload clean-up", () => {
  beforeAll(async () => {
    const [clock] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    if (!clock) throw new Error("Unable to read database time.");
    databaseNow = clock.now;
    await prisma.user.create({
      data: {
        id: userId,
        name: userId,
        email: `${userId}@example.test`,
        image: url(avatarKey("current.webp")),
      },
    });
    await prisma.group.create({
      data: { id: groupId, name: "Group", image: url(groupKey("group-current.webp")) },
    });
  });

  afterEach(() => {
    send.mockReset();
    pages = [];
    deleted = [];
    failDeletes = false;
  });

  afterAll(async () => {
    send.mockRestore();
    await prisma.group.deleteMany({ where: { id: groupId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  test("deletes stale pending uploads and their files, keeping recent and in-use ones", async () => {
    mockStorage();
    await prisma.pendingUpload.createMany({
      data: [
        {
          uploadType: "groupAvatar",
          groupId,
          fileName: "abandoned.webp",
          createdAt: ago(61 * minute),
        },
        {
          uploadType: "userAvatar",
          groupId: "",
          fileName: "current.webp",
          createdAt: ago(2 * 60 * minute),
        },
        {
          uploadType: "groupAvatar",
          groupId: `${groupId}-other`,
          fileName: "recent.webp",
          createdAt: ago(10 * minute),
        },
      ].map((upload) => ({ ...upload, userId })),
    });
    await runStalePendingUploadCleanup();
    expect(await pendingFileNames()).toEqual(["recent.webp"]);
    expect(deletedKeys()).toEqual(["abandoned.webp@v1"]);
    await prisma.pendingUpload.deleteMany({ where: { userId } });
  });

  test("keeps a pending upload whose file can't be deleted and logs only a code", async () => {
    mockStorage();
    failDeletes = true;
    const error = spyOn(console, "error").mockImplementation(() => {});
    await prisma.pendingUpload.create({
      data: {
        userId,
        uploadType: "groupAvatar",
        groupId,
        fileName: "stuck.webp",
        createdAt: ago(2 * 60 * minute),
      },
    });
    await runStalePendingUploadCleanup();
    expect(await pendingFileNames()).toEqual(["stuck.webp"]);
    expect(error.mock.calls).toHaveLength(1);
    expect(String(error.mock.calls[0]?.[0])).toMatch(
      /^Pending upload clean-up failed for \d+ upload\(s\) \(AccessDenied\)$/,
    );
    expect(String(error.mock.calls[0]?.[0])).not.toContain(prefix);
    error.mockRestore();
    await prisma.pendingUpload.deleteMany({ where: { userId } });
  });

  test("skips a pending upload that a confirmation is holding", async () => {
    mockStorage();
    await prisma.pendingUpload.create({
      data: {
        userId,
        uploadType: "groupAvatar",
        groupId,
        fileName: "confirming.webp",
        createdAt: ago(2 * 60 * minute),
      },
    });
    const error = spyOn(console, "error").mockImplementation(() => {});
    const rollback = new Error("roll back the confirmation");
    const confirmation = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM "PendingUpload" WHERE "userId" = ${userId} FOR UPDATE`;
      await runStalePendingUploadCleanup();
      throw rollback;
    });
    await expect(confirmation).rejects.toBe(rollback);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    expect(deletedKeys()).toEqual([]);
    expect(await pendingFileNames()).toEqual(["confirming.webp"]);
    await runStalePendingUploadCleanup();
    expect(await pendingFileNames()).toEqual([]);
    expect(deletedKeys()).toEqual(["confirming.webp@v1"]);
  });

  test("sweeps files that nothing references across pages and keeps the rest", async () => {
    mockStorage();
    await prisma.pendingUpload.create({
      data: {
        userId,
        uploadType: "groupAvatar",
        groupId,
        fileName: "waiting.webp",
        createdAt: ago(10 * minute),
      },
    });
    const version = (key: string, versionId: string, age: number, isLatest = true) => ({
      Key: key,
      VersionId: versionId,
      LastModified: ago(age),
      IsLatest: isLatest,
    });
    pages = [
      {
        Versions: [
          version(avatarKey("current.webp"), "latest", 3 * 60 * minute),
          version(avatarKey("current.webp"), "old", 4 * 60 * minute, false),
          version(avatarKey("orphan.webp"), "o1", 2 * 60 * minute),
          version(avatarKey("fresh.webp"), "f1", 5 * minute),
        ],
        DeleteMarkers: [version(avatarKey("gone.webp"), "marker", 2 * 60 * minute)],
      },
      {
        Versions: [
          version(groupKey("group-current.webp"), "g1", 2 * 60 * minute),
          version(groupKey("waiting.webp"), "w1", 2 * 60 * minute),
          version(`user/${userId}/notes/${prefix}.txt`, "n1", 2 * 60 * minute),
          version(
            `user/${userId}/uploads/group/${prefix}-deleted/avatar/left.webp`,
            "l1",
            2 * 60 * minute,
          ),
        ],
      },
    ];
    await runImageStorageSweep();
    expect(deletedKeys()).toEqual([
      "current.webp@old",
      "gone.webp@marker",
      "left.webp@l1",
      "orphan.webp@o1",
    ]);
    await prisma.pendingUpload.deleteMany({ where: { userId } });
  });

  test("skips the whole sweep when a stored image URL doesn't match the configured prefix", async () => {
    mockStorage();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const otherUserId = `${prefix}-other-cdn`;
    await prisma.user.create({
      data: {
        id: otherUserId,
        name: otherUserId,
        email: `${otherUserId}@example.test`,
        image: `https://other-cdn.example.test/${env.S3_BUCKET_NAME}/user/${otherUserId}/uploads/avatar/current.webp`,
      },
    });
    pages = [
      {
        Versions: [
          {
            Key: avatarKey("orphan.webp"),
            VersionId: "o1",
            LastModified: ago(2 * 60 * minute),
            IsLatest: true,
          },
        ],
      },
    ];
    await runImageStorageSweep();
    await prisma.user.deleteMany({ where: { id: otherUserId } });
    expect(send).not.toHaveBeenCalled();
    expect(deletedKeys()).toEqual([]);
    expect(error.mock.calls).toEqual([
      ["Image storage sweep skipped: stored image URLs don't match S3_CDN_URL and S3_BUCKET_NAME"],
    ]);
    error.mockRestore();
  });

  test("skips the sweep when a group image uses a different bucket", async () => {
    mockStorage();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const otherGroupId = `${prefix}-other-bucket`;
    await prisma.group.create({
      data: {
        id: otherGroupId,
        name: "Group",
        image: `${env.S3_CDN_URL}/other-bucket/user/${userId}/uploads/group/${otherGroupId}/avatar/a.webp`,
      },
    });
    pages = [
      {
        Versions: [
          {
            Key: avatarKey("orphan.webp"),
            VersionId: "o1",
            LastModified: ago(2 * 60 * minute),
            IsLatest: true,
          },
        ],
      },
    ];
    await runImageStorageSweep();
    await prisma.group.deleteMany({ where: { id: otherGroupId } });
    expect(deletedKeys()).toEqual([]);
    expect(error.mock.calls).toHaveLength(1);
    error.mockRestore();
  });

  test("logs a sweep failure without the storage error", async () => {
    mockStorage();
    failDeletes = true;
    const error = spyOn(console, "error").mockImplementation(() => {});
    pages = [
      {
        Versions: [
          {
            Key: avatarKey("orphan.webp"),
            VersionId: "o1",
            LastModified: ago(2 * 60 * minute),
            IsLatest: true,
          },
        ],
      },
    ];
    await runImageStorageSweep();
    expect(error.mock.calls).toEqual([["Image storage sweep failed"]]);
    error.mockRestore();
  });
});
