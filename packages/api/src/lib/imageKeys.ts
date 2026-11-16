import { Prisma, type PrismaClient } from "@openbeacon/database";
import type { encryptedImageKeySchema } from "@openbeacon/schemas";
import { TRPCError } from "@trpc/server";
import type z from "zod";
import type { StoredImageKey } from "../types/GroupListItem.ts";
import { ReasonError } from "./reasonError.ts";

export const imageKeySelect = {
  imageKeyEpochId: true,
  imageKeySenderDeviceId: true,
  imageKeyAlgorithm: true,
  imageKeyNonce: true,
  imageKeyCiphertext: true,
} as const;

export const toStoredImageKey = (row: {
  [column in keyof typeof imageKeySelect]: string | null;
}): StoredImageKey | null =>
  row.imageKeyEpochId &&
  row.imageKeySenderDeviceId &&
  row.imageKeyAlgorithm &&
  row.imageKeyNonce &&
  row.imageKeyCiphertext
    ? {
        algorithm: row.imageKeyAlgorithm,
        ciphertext: row.imageKeyCiphertext,
        epochId: row.imageKeyEpochId,
        nonce: row.imageKeyNonce,
        senderDeviceId: row.imageKeySenderDeviceId,
      }
    : null;

export const imageKeyColumns = (key: z.infer<typeof encryptedImageKeySchema> | null) => ({
  imageKeyEpochId: key?.epochId ?? null,
  imageKeySenderDeviceId: key?.senderDeviceId ?? null,
  imageKeyAlgorithm: key?.algorithm ?? null,
  imageKeyNonce: key?.nonce ?? null,
  imageKeyCiphertext: key?.ciphertext ?? null,
});

export const imageFileName = (imageUrl: string | null) =>
  imageUrl ? imageUrl.slice(imageUrl.lastIndexOf("/") + 1) : null;

export const imageChanged = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "This picture has changed. Try again.",
    cause: new ReasonError("IMAGE_CHANGED"),
  });

export const readImageKeysNeedCatchUp = async ({
  db,
  userId,
}: {
  db: Pick<PrismaClient, "$queryRaw">;
  userId: string;
}) => {
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT g.id
    FROM "Group" g
    JOIN "GroupMember" me ON me."groupId" = g.id AND me."userId" = ${userId}
    CROSS JOIN LATERAL (
      SELECT e.id FROM "GroupEpoch" e
      WHERE e."groupId" = g.id
      ORDER BY e."epochNumber" DESC
      LIMIT 1
    ) latest
    WHERE NOT g."epochRotationRequired"
      AND (
        (g."imageKeyEpochId" IS NOT NULL AND g."imageKeyEpochId" <> latest.id)
        OR EXISTS (
          SELECT 1 FROM "GroupMember" m
          JOIN "User" u ON u.id = m."userId"
          WHERE m."groupId" = g.id
            AND (
              (m."imageKeyEpochId" IS NOT NULL AND m."imageKeyEpochId" <> latest.id)
              OR (m."userId" = ${userId} AND u.image IS NOT NULL AND m."imageKeyCiphertext" IS NULL)
            )
        )
      )
    ORDER BY g.id
  `);
  return rows.map(({ id }) => id);
};
