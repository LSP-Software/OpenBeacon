import { Prisma } from "@openbeacon/database";
import { reEncryptImageKeysSchema, storeImageKeySchema } from "@openbeacon/schemas";
import type { TRPCRouterRecord } from "@trpc/server";
import {
  assertActiveDevices,
  assertLatestGroupEpoch,
  lockGroupMemberForWrite,
} from "../../lib/groupWriteChecks.ts";
import {
  assertKeysFromThisDevice,
  imageChanged,
  imageFileName,
  imageKeyColumns,
  imageKeySelect,
  toStoredImageKey,
} from "../../lib/imageKeys.ts";
import { groupMemberProcedure } from "../../procedures/auth/group.ts";

export const groupImageKeysRouter = {
  store: groupMemberProcedure
    .meta({ rateLimit: { limit: 60, windowMs: 60_000 } })
    .input(storeImageKeySchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      assertKeysFromThisDevice([input.key], ctx.deviceId);
      return ctx.db.$transaction(async (tx) => {
        const member = await lockGroupMemberForWrite(tx, {
          groupId: input.groupId,
          groupLock: "FOR NO KEY UPDATE",
          userId,
        });
        await assertActiveDevices(tx, { deviceIds: [ctx.deviceId], userId });
        await assertLatestGroupEpoch(tx, { epochIds: [input.key.epochId], groupId: input.groupId });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { image: true },
        });
        if (imageFileName(user.image) !== input.fileName) throw imageChanged();
        const updated = await tx.groupMember.update({
          where: { id: member.id },
          data: imageKeyColumns(input.key),
          select: imageKeySelect,
        });
        return { imageKey: toStoredImageKey(updated) };
      });
    }),
  reEncrypt: groupMemberProcedure
    .meta({ rateLimit: { limit: 120, windowMs: 60_000 } })
    .input(reEncryptImageKeysSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      assertKeysFromThisDevice(
        input.keys.map(({ key }) => key),
        ctx.deviceId,
      );
      return ctx.db.$transaction(async (tx) => {
        await lockGroupMemberForWrite(tx, {
          groupId: input.groupId,
          groupLock: "FOR NO KEY UPDATE",
          userId,
        });
        await assertActiveDevices(tx, { deviceIds: [ctx.deviceId], userId });
        await assertLatestGroupEpoch(tx, {
          epochIds: [...new Set(input.keys.map(({ key }) => key.epochId))],
          groupId: input.groupId,
        });
        const memberIds = input.keys.flatMap(({ target }) =>
          target.kind === "member" ? [target.memberId] : [],
        );
        const targetUsers = await tx.groupMember.findMany({
          where: { id: { in: memberIds }, groupId: input.groupId },
          select: { userId: true },
        });
        const targetUserIds = [...new Set(targetUsers.map((member) => member.userId))].sort();
        if (targetUserIds.length > 0) {
          await tx.$queryRaw(Prisma.sql`
            SELECT id FROM "User" WHERE id IN (${Prisma.join(targetUserIds)}) ORDER BY id FOR SHARE
          `);
        }
        const group = await tx.group.findUniqueOrThrow({
          where: { id: input.groupId },
          select: { image: true, ...imageKeySelect },
        });
        const members = await tx.groupMember.findMany({
          where: { id: { in: memberIds }, groupId: input.groupId },
          select: { id: true, ...imageKeySelect, user: { select: { image: true } } },
        });
        const membersById = new Map(members.map((member) => [member.id, member]));
        const reEncrypted: typeof input.keys = [];
        const skipped: typeof input.keys = [];
        const changed: typeof input.keys = [];
        const gone: typeof input.keys = [];
        for (const request of input.keys) {
          const member =
            request.target.kind === "member" ? membersById.get(request.target.memberId) : undefined;
          const image = request.target.kind === "group" ? group.image : member?.user.image;
          const storedKey =
            request.target.kind === "group"
              ? toStoredImageKey(group)
              : member && toStoredImageKey(member);
          if (!image || !storedKey) {
            gone.push(request);
          } else if (
            storedKey.ciphertext !== request.expectedCiphertext ||
            imageFileName(image) !== request.fileName
          ) {
            changed.push(request);
          } else if (storedKey.epochId === request.key.epochId) {
            skipped.push(request);
          } else {
            if (request.target.kind === "group") {
              await tx.group.update({
                where: { id: input.groupId },
                data: imageKeyColumns(request.key),
              });
            } else {
              await tx.groupMember.update({
                where: { id: request.target.memberId },
                data: imageKeyColumns(request.key),
              });
            }
            reEncrypted.push(request);
          }
        }
        return {
          reEncrypted: reEncrypted.map(({ target }) => target),
          skipped: skipped.map(({ target }) => target),
          changed: changed.map(({ target }) => target),
          gone: gone.map(({ target }) => target),
        };
      });
    }),
} satisfies TRPCRouterRecord;
