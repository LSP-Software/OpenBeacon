import { Prisma } from "@openbeacon/database";
import { env } from "@openbeacon/api/env.ts";
import { buildGroupAvatarPath, buildUserAvatarPath } from "@openbeacon/api/image-upload.ts";
import {
  deleteImageKey,
  deleteImageVersionList,
  forEachImageVersionPage,
} from "@openbeacon/api/storage.ts";
import { errorCode, tryCatch } from "@openbeacon/shared";
import { getDatabaseTime } from "../databaseTime.ts";
import { services } from "../services.ts";

const gracePeriodMs = 60 * 60_000;
const uploadKeyPattern = /^user\/([^/]+)\/uploads\/(?:avatar|group\/([^/]+)\/avatar)\/([^/]+)$/;

const pendingUploadKey = (upload: {
  userId: string;
  uploadType: "userAvatar" | "groupAvatar";
  groupId: string;
  fileName: string;
}) =>
  `${
    upload.uploadType === "groupAvatar"
      ? buildGroupAvatarPath(upload.userId, upload.groupId)
      : buildUserAvatarPath(upload.userId)
  }/${upload.fileName}`;

const imageUrl = (key: string) => `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}/${key}`;

const failureCode = (error: unknown) =>
  errorCode(error) ?? (error instanceof Error && error.name !== "Error" ? error.name : null);

export const runStalePendingUploadCleanup = async () => {
  const cutoff = new Date((await getDatabaseTime()).getTime() - gracePeriodMs);
  const stale = await services.db.pendingUpload.findMany({
    where: { createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  const failures = new Map<string, number>();
  for (const upload of stale) {
    const result = await tryCatch(
      services.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ fileName: string }>>(Prisma.sql`
            SELECT "fileName" FROM "PendingUpload"
            WHERE "userId" = ${upload.userId}
              AND "uploadType" = ${upload.uploadType}::"ImageUploadType"
              AND "groupId" = ${upload.groupId}
              AND "fileName" = ${upload.fileName}
            FOR UPDATE SKIP LOCKED
          `);
          if (locked.length === 0) return;
          const key = pendingUploadKey(upload);
          const referenced =
            (await tx.user.count({ where: { image: imageUrl(key) } })) +
            (await tx.group.count({ where: { image: imageUrl(key) } }));
          if (referenced === 0) await deleteImageKey(env.S3_BUCKET_NAME, key);
          await tx.pendingUpload.deleteMany({
            where: {
              userId: upload.userId,
              uploadType: upload.uploadType,
              groupId: upload.groupId,
              fileName: upload.fileName,
            },
          });
        },
        { timeout: 60_000 },
      ),
    );
    if (result.error) {
      const code = failureCode(result.error) ?? "unknown";
      failures.set(code, (failures.get(code) ?? 0) + 1);
    }
  }
  if (failures.size > 0) {
    const count = [...failures.values()].reduce((total, value) => total + value, 0);
    console.error(
      `Pending upload clean-up failed for ${count} upload(s) (${[...failures.keys()].join(", ")})`,
    );
  }
};

export const runImageStorageSweep = async () => {
  const urlPrefix = `${env.S3_CDN_URL}/${env.S3_BUCKET_NAME}/`;
  const [check] = await services.db.$queryRaw<Array<{ mismatched: boolean }>>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM "User"
      WHERE strpos(image, '/user/') > 0 AND NOT starts_with(image, ${urlPrefix})
    ) OR EXISTS (
      SELECT 1 FROM "Group"
      WHERE strpos(image, '/user/') > 0 AND NOT starts_with(image, ${urlPrefix})
    ) AS mismatched
  `);
  if (check?.mismatched !== false) {
    console.error(
      "Image storage sweep skipped: stored image URLs don't match S3_CDN_URL and S3_BUCKET_NAME",
    );
    return;
  }
  const cutoff = new Date((await getDatabaseTime()).getTime() - gracePeriodMs);
  const result = await tryCatch(
    forEachImageVersionPage(env.S3_BUCKET_NAME, "user/", async (versions) => {
      const candidates = versions.filter(
        ({ key, lastModified }) => lastModified < cutoff && uploadKeyPattern.test(key),
      );
      if (candidates.length === 0) return;
      const keys = [...new Set(candidates.map(({ key }) => key))];
      const fileNames = [...new Set(keys.map((key) => key.slice(key.lastIndexOf("/") + 1)))];
      const [users, groups, pending] = await services.db.$transaction(
        [
          services.db.user.findMany({
            where: { image: { in: keys.map(imageUrl) } },
            select: { image: true },
          }),
          services.db.group.findMany({
            where: { image: { in: keys.map(imageUrl) } },
            select: { image: true },
          }),
          services.db.pendingUpload.findMany({ where: { fileName: { in: fileNames } } }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      const referenced = new Set([...users, ...groups].map(({ image }) => image));
      const pendingKeys = new Set(pending.map(pendingUploadKey));
      const toDelete = candidates
        .filter(({ key, isLatest }) =>
          referenced.has(imageUrl(key)) ? !isLatest : !pendingKeys.has(key),
        )
        .map(({ key, versionId }) => ({ Key: key, VersionId: versionId }));
      await deleteImageVersionList(env.S3_BUCKET_NAME, toDelete);
    }),
  );
  if (result.error) {
    const code = failureCode(result.error);
    console.error(`Image storage sweep failed${code ? ` (${code})` : ""}`);
  }
};
