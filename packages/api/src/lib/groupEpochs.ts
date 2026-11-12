import type { SecurityAlerts } from "@openbeacon/auth";
import { Prisma, type PrismaClient } from "@openbeacon/database";
import {
  DEVICE_KEY_ALGORITHM,
  decodeBase64,
  isUsableX25519PublicKey,
  type RecipientPublicKeyMaterial,
  serializeRecipientPublicKeyMaterial,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  type WrappedEpochKey,
  type WrappedHistoryEpochKey,
} from "@openbeacon/encryption";
import {
  type deviceIconSchema,
  type devicePlatformSchema,
  HISTORY_RECIPIENT_MISMATCH_MESSAGE,
} from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCError } from "@trpc/server";
import type { z } from "zod";
import { deviceRemovedError } from "./deviceRemoved.ts";
import { emailInviteCreatedAfter } from "./emailInvites.ts";

type DeviceRecord = {
  createdAt: Date;
  id: string;
  publicKey: string;
  publicKeyAlgorithm: string;
  revokedAt: Date | null;
  userId: string;
};

type UserDeviceDb = Pick<PrismaClient, "userDevice"> | Pick<Prisma.TransactionClient, "userDevice">;
type InviteAcceptanceDb =
  | Pick<PrismaClient, "accountHistoryKey" | "groupEpoch" | "groupMemberInvite" | "userDevice">
  | Pick<
      Prisma.TransactionClient,
      "accountHistoryKey" | "groupEpoch" | "groupMemberInvite" | "userDevice"
    >;
type GroupRemovalDb =
  | Pick<PrismaClient, "accountHistoryKey" | "groupEpoch" | "groupMember" | "userDevice">
  | Pick<
      Prisma.TransactionClient,
      "accountHistoryKey" | "groupEpoch" | "groupMember" | "userDevice"
    >;
type GroupEpochPersistenceDb = Pick<
  Prisma.TransactionClient,
  | "$queryRaw"
  | "group"
  | "groupEpoch"
  | "groupEpochHistoryWrap"
  | "groupEpochRecipientKey"
  | "groupMember"
  | "userDevice"
>;

const sortIds = (ids: string[]) => ids.slice().sort((left, right) => left.localeCompare(right));

const assertExactRecipientSet = ({
  actual,
  expected,
  message = "Epoch recipient set does not match the active group devices.",
}: {
  actual: string[];
  expected: string[];
  message?: string;
}) => {
  const sortedActual = sortIds(actual);
  const sortedExpected = sortIds(expected);

  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((id, index) => id !== sortedExpected[index])
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
};

const keepCurrentHistoryKeys = <HistoryKey extends { userId: string; version: number }>(
  historyKeys: HistoryKey[],
) => {
  const current = new Map<string, HistoryKey>();
  for (const historyKey of historyKeys) {
    const existing = current.get(historyKey.userId);
    if (!existing || existing.version < historyKey.version) {
      current.set(historyKey.userId, historyKey);
    }
  }
  return [...current.values()];
};

export const listHistoryRecipients = async ({
  db,
  where,
}: {
  db: Pick<PrismaClient, "accountHistoryKey"> | Pick<Prisma.TransactionClient, "accountHistoryKey">;
  where: Prisma.AccountHistoryKeyWhereInput;
}) => {
  const historyKeys = await db.accountHistoryKey.findMany({
    orderBy: [{ userId: "asc" }, { version: "asc" }],
    select: { id: true, publicKey: true, userId: true, version: true },
    where,
  });

  return keepCurrentHistoryKeys(historyKeys).map(({ id, publicKey, userId, version }) => ({
    historyKeyId: id,
    publicKey,
    userId,
    version,
  }));
};

const mapRecipientPublicKeys = (devices: DeviceRecord[]) =>
  devices.map((device) =>
    serializeRecipientPublicKeyMaterial({
      algorithm: device.publicKeyAlgorithm,
      createdAt: device.createdAt,
      deviceId: device.id,
      publicKey: device.publicKey,
      revokedAt: device.revokedAt,
      userId: device.userId,
    }),
  );

export const listUserRecipientPublicKeys = async ({
  db,
  userId,
}: {
  db: UserDeviceDb;
  userId: string;
}): Promise<RecipientPublicKeyMaterial[]> => {
  const devices = await db.userDevice.findMany({
    orderBy: {
      id: "asc",
    },
    select: {
      createdAt: true,
      id: true,
      publicKey: true,
      publicKeyAlgorithm: true,
      revokedAt: true,
      userId: true,
    },
    where: {
      revokedAt: null,
      activatedAt: { not: null },
      userId,
    },
  });

  return mapRecipientPublicKeys(devices);
};

export const getInviteAcceptanceContext = async ({
  db,
  inviteId,
  userId,
}: {
  db: InviteAcceptanceDb;
  inviteId: string;
  userId: string;
}) => {
  const invite = await db.groupMemberInvite.findFirst({
    select: {
      groupId: true,
    },
    where: {
      id: inviteId,
      recipientId: userId,
      createdAt: { gt: emailInviteCreatedAfter() },
    },
  });

  if (!invite) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
  }

  return getGroupJoinContext({ db, groupId: invite.groupId, userId });
};

export const getGroupJoinContext = async ({
  db,
  groupId,
  userId,
}: {
  db:
    | Pick<PrismaClient, "accountHistoryKey" | "groupEpoch" | "userDevice">
    | Pick<Prisma.TransactionClient, "accountHistoryKey" | "groupEpoch" | "userDevice">;
  groupId: string;
  userId: string;
}) => {
  const latestEpoch = await db.groupEpoch.findFirst({
    orderBy: {
      epochNumber: "desc",
    },
    select: {
      createdAt: true,
      createdByDeviceId: true,
      epochNumber: true,
      groupId: true,
      id: true,
    },
    where: {
      groupId: groupId,
    },
  });

  const devices = await db.userDevice.findMany({
    orderBy: {
      id: "asc",
    },
    select: {
      createdAt: true,
      id: true,
      publicKey: true,
      publicKeyAlgorithm: true,
      revokedAt: true,
      userId: true,
    },
    where: {
      revokedAt: null,
      activatedAt: { not: null },
      OR: [
        {
          user: {
            groupMembers: {
              some: {
                groupId: groupId,
              },
            },
          },
        },
        {
          userId,
        },
      ],
    },
  });

  return {
    groupId: groupId,
    latestEpoch:
      latestEpoch === null
        ? null
        : {
            createdAt: latestEpoch.createdAt,
            createdByDeviceId: latestEpoch.createdByDeviceId,
            epochId: latestEpoch.id,
            epochNumber: latestEpoch.epochNumber,
            groupId: latestEpoch.groupId,
          },
    historyRecipients: await listHistoryRecipients({
      db,
      where: { OR: [{ user: { groupMembers: { some: { groupId } } } }, { userId }] },
    }),
    recipients: mapRecipientPublicKeys(devices),
  };
};

export const getGroupRemovalContext = async ({
  db,
  groupId,
  memberId,
}: {
  db: GroupRemovalDb;
  groupId: string;
  memberId: string;
}) => {
  const member = await db.groupMember.findFirst({
    select: {
      userId: true,
    },
    where: {
      groupId,
      id: memberId,
    },
  });

  if (!member) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Group member not found" });
  }

  const latestEpoch = await db.groupEpoch.findFirst({
    orderBy: {
      epochNumber: "desc",
    },
    select: {
      createdAt: true,
      createdByDeviceId: true,
      epochNumber: true,
      groupId: true,
      id: true,
    },
    where: {
      groupId,
    },
  });

  const devices = await db.userDevice.findMany({
    orderBy: {
      id: "asc",
    },
    select: {
      createdAt: true,
      id: true,
      publicKey: true,
      publicKeyAlgorithm: true,
      revokedAt: true,
      userId: true,
    },
    where: {
      revokedAt: null,
      activatedAt: { not: null },
      user: {
        groupMembers: {
          some: {
            groupId,
          },
        },
      },
      userId: {
        not: member.userId,
      },
    },
  });

  return {
    latestEpoch:
      latestEpoch === null
        ? null
        : {
            createdAt: latestEpoch.createdAt,
            createdByDeviceId: latestEpoch.createdByDeviceId,
            epochId: latestEpoch.id,
            epochNumber: latestEpoch.epochNumber,
            groupId: latestEpoch.groupId,
          },
    historyRecipients: await listHistoryRecipients({
      db,
      where: {
        user: { groupMembers: { some: { groupId } } },
        userId: { not: member.userId },
      },
    }),
    recipients: mapRecipientPublicKeys(devices),
    removedUserId: member.userId,
  };
};

export const persistGroupEpoch = async ({
  db,
  deviceId,
  epoch,
  excludedUserId,
  groupId,
  userId,
}: {
  db: GroupEpochPersistenceDb;
  deviceId: string;
  epoch: {
    createdByDeviceId: string;
    epochId: string;
    epochNumber: number;
    historyKeys: WrappedHistoryEpochKey[];
    recipientKeys: WrappedEpochKey[];
  };
  excludedUserId?: string;
  groupId: string;
  userId: string;
}) => {
  if (epoch.createdByDeviceId !== deviceId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Group keys must be created by this phone.",
    });
  }

  const actingMember = await db.groupMember.findFirst({
    select: {
      id: true,
    },
    where: {
      groupId,
      userId,
    },
  });

  if (!actingMember) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of this group" });
  }

  const actingDevice = await db.userDevice.findFirst({
    select: {
      id: true,
      publicKey: true,
    },
    where: {
      id: epoch.createdByDeviceId,
      revokedAt: null,
      activatedAt: { not: null },
      userId,
    },
  });

  if (!actingDevice) {
    throw new TRPCError({ code: "FORBIDDEN", message: "The active device is not registered." });
  }

  const latestEpoch = await db.groupEpoch.findFirst({
    orderBy: {
      epochNumber: "desc",
    },
    select: {
      epochNumber: true,
    },
    where: {
      groupId,
    },
  });
  const expectedEpochNumber = (latestEpoch?.epochNumber ?? 0) + 1;

  if (epoch.epochNumber !== expectedEpochNumber) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Epoch number does not match the next group epoch.",
    });
  }

  const wrappedKeys = [...epoch.recipientKeys, ...epoch.historyKeys];
  for (const wrappedKey of wrappedKeys) {
    if (wrappedKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported wrapped epoch key algorithm.",
      });
    }

    if (wrappedKey.epochId !== epoch.epochId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Wrapped epoch keys must target the same epoch.",
      });
    }

    if (wrappedKey.senderPublicKey !== actingDevice.publicKey) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Wrapped epoch keys must be created by the active device.",
      });
    }
  }

  const activeDevices = await db.userDevice.findMany({
    orderBy: {
      id: "asc",
    },
    select: {
      createdAt: true,
      id: true,
      publicKey: true,
      publicKeyAlgorithm: true,
      revokedAt: true,
      userId: true,
    },
    where: {
      revokedAt: null,
      activatedAt: { not: null },
      ...(excludedUserId ? { userId: { not: excludedUserId } } : {}),
      user: {
        groupMembers: {
          some: {
            groupId,
          },
        },
      },
    },
  });

  assertExactRecipientSet({
    actual: epoch.recipientKeys.map((recipientKey) => recipientKey.recipientDeviceId),
    expected: activeDevices.map((device) => device.id),
  });

  for (const wrappedKey of wrappedKeys) {
    if (!isUsableX25519PublicKey(decodeBase64(wrappedKey.ephemeralPublicKey))) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Invalid wrapped epoch key public key.",
      });
    }
  }

  const currentHistoryKeys = keepCurrentHistoryKeys(
    await db.$queryRaw<Array<{ id: string; userId: string; version: number }>>(
      Prisma.sql`SELECT k.id, k."userId", k.version FROM "AccountHistoryKey" k
        JOIN "GroupMember" m ON m."userId" = k."userId" AND m."groupId" = ${groupId}
        ${excludedUserId ? Prisma.sql`WHERE k."userId" <> ${excludedUserId}` : Prisma.empty}
        FOR SHARE OF k`,
    ),
  );

  assertExactRecipientSet({
    actual: epoch.historyKeys.map(({ historyKeyVersion, userId: recipientUserId }) =>
      JSON.stringify([recipientUserId, historyKeyVersion]),
    ),
    expected: currentHistoryKeys.map(({ userId: recipientUserId, version }) =>
      JSON.stringify([recipientUserId, version]),
    ),
    message: HISTORY_RECIPIENT_MISMATCH_MESSAGE,
  });

  const historyWrapsByUser = new Map(epoch.historyKeys.map((wrap) => [wrap.userId, wrap]));
  const historyWraps = currentHistoryKeys.flatMap(({ id, userId: keyUserId }) => {
    const wrap = historyWrapsByUser.get(keyUserId);
    return wrap
      ? [
          {
            algorithm: wrap.algorithm,
            ephemeralPublicKey: wrap.ephemeralPublicKey,
            groupEpochId: epoch.epochId,
            historyKeyId: id,
            senderDeviceId: actingDevice.id,
            senderPublicKey: wrap.senderPublicKey,
            wrappedKey: wrap.wrappedKey,
          },
        ]
      : [];
  });

  await db.groupEpoch.create({
    data: {
      createdByDeviceId: epoch.createdByDeviceId,
      senderPublicKey: actingDevice.publicKey,
      epochNumber: epoch.epochNumber,
      groupId,
      id: epoch.epochId,
    },
  });

  await db.groupEpochRecipientKey.createMany({
    data: epoch.recipientKeys.map((recipientKey) => ({
      algorithm: recipientKey.algorithm,
      createdAt: recipientKey.createdAt,
      ephemeralPublicKey: recipientKey.ephemeralPublicKey,
      groupEpochId: epoch.epochId,
      recipientDeviceId: recipientKey.recipientDeviceId,
      wrappedKey: recipientKey.wrappedKey,
    })),
  });
  if (historyWraps.length > 0) {
    await db.groupEpochHistoryWrap.createMany({ data: historyWraps });
  }
  await db.group.updateMany({
    where: { id: groupId, epochRotationRequired: true },
    data: { epochRotationRequired: false },
  });
};

export const defaultDeviceIcon = (model: string | undefined) =>
  model && /iPad|Tab/.test(model) ? "tablet" : "phone";

export const upsertUserDevice = async ({
  db,
  input,
  securityAlerts,
  sessionId,
  userId,
}: {
  db: Pick<PrismaClient, "$transaction" | "userDevice">;
  input: {
    algorithm: string;
    deviceId: string;
    publicKey: string;
    platform?: z.infer<typeof devicePlatformSchema> | undefined;
    model?: string | undefined;
    name?: string | undefined;
    icon?: z.infer<typeof deviceIconSchema> | undefined;
  };
  securityAlerts: SecurityAlerts | null;
  sessionId: string | null;
  userId: string;
}) => {
  if (input.algorithm !== DEVICE_KEY_ALGORITHM) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported device key algorithm." });
  }

  const existingDevice = await db.userDevice.findUnique({
    where: {
      id: input.deviceId,
    },
  });

  if (existingDevice && existingDevice.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This device is already registered to another user.",
    });
  }

  if (existingDevice) {
    if (existingDevice.revokedAt) throw deviceRemovedError();
    if (
      existingDevice.publicKey !== input.publicKey ||
      existingDevice.publicKeyAlgorithm !== input.algorithm
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This device ID is already registered with different key material.",
      });
    }

    return existingDevice;
  }

  const createResult = await tryCatch(
    db.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`);
      const pending =
        (await tx.userDevice.count({ where: { userId, activatedAt: { not: null } } })) > 0;
      const device = await tx.userDevice.create({
        data: {
          id: input.deviceId,
          model: input.model ?? null,
          name: input.name ?? input.model ?? "Phone",
          icon: input.icon ?? defaultDeviceIcon(input.model),
          activatedAt: pending ? null : new Date(),
          activatedBy: pending ? null : "firstDevice",
          platform: input.platform ?? null,
          publicKey: input.publicKey,
          publicKeyAlgorithm: input.algorithm,
          userId,
        },
      });
      if (sessionId) {
        await tx.session.updateMany({
          data: { deviceId: device.id },
          where: { id: sessionId, userId },
        });
      }
      if (!pending) {
        await tx.group.updateMany({
          data: { epochRotationRequired: true },
          where: { groupMembers: { some: { userId } } },
        });
      }
      return device;
    }),
  );

  if (!createResult.error) {
    if (createResult.data.activatedAt === null) {
      securityAlerts?.send(userId, {
        type: "new-sign-in",
        device: { model: input.model ?? null, platform: input.platform ?? null },
      });
    }
    return createResult.data;
  }

  const error = createResult.error;

  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    throw error;
  }

  const uniqueTarget = error.meta?.["target"];
  const targets =
    typeof uniqueTarget === "string"
      ? [uniqueTarget]
      : Array.isArray(uniqueTarget)
        ? uniqueTarget.filter((target): target is string => typeof target === "string")
        : [];

  if (targets.length > 0 && !targets.includes("id")) {
    throw error;
  }

  const conflictingDevice = await db.userDevice.findUnique({
    where: {
      id: input.deviceId,
    },
  });

  if (conflictingDevice && conflictingDevice.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This device is already registered to another user.",
    });
  }

  if (
    conflictingDevice &&
    conflictingDevice.publicKey === input.publicKey &&
    conflictingDevice.publicKeyAlgorithm === input.algorithm
  ) {
    if (conflictingDevice.revokedAt) throw deviceRemovedError();
    return conflictingDevice;
  }

  if (conflictingDevice) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This device ID is already registered with different key material.",
    });
  }

  throw error;
};
