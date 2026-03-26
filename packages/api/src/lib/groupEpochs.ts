import type { Prisma, PrismaClient } from "@openbeacon/database";
import {
  DEVICE_KEY_ALGORITHM,
  type RecipientPublicKeyMaterial,
  serializeRecipientPublicKeyMaterial,
  WRAPPED_EPOCH_KEY_ALGORITHM,
  type WrappedEpochKey,
} from "@openbeacon/encryption";
import { TRPCError } from "@trpc/server";

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
  | Pick<PrismaClient, "groupEpoch" | "groupMemberInvite" | "userDevice">
  | Pick<Prisma.TransactionClient, "groupEpoch" | "groupMemberInvite" | "userDevice">;
type GroupRemovalDb =
  | Pick<PrismaClient, "groupEpoch" | "groupMember" | "userDevice">
  | Pick<Prisma.TransactionClient, "groupEpoch" | "groupMember" | "userDevice">;
type GroupEpochPersistenceDb =
  | Pick<PrismaClient, "groupEpoch" | "groupEpochRecipientKey" | "groupMember" | "userDevice">
  | Pick<
      Prisma.TransactionClient,
      "groupEpoch" | "groupEpochRecipientKey" | "groupMember" | "userDevice"
    >;

const sortIds = (ids: string[]) => ids.slice().sort((left, right) => left.localeCompare(right));

const assertExactRecipientSet = ({
  actual,
  expected,
}: {
  actual: string[];
  expected: string[];
}) => {
  const sortedActual = sortIds(actual);
  const sortedExpected = sortIds(expected);

  if (sortedActual.length !== sortedExpected.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Epoch recipient set does not match the active group devices.",
    });
  }

  for (let index = 0; index < sortedActual.length; index += 1) {
    if (sortedActual[index] !== sortedExpected[index]) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Epoch recipient set does not match the active group devices.",
      });
    }
  }
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

export const listActiveGroupRecipientPublicKeys = async ({
  db,
  groupId,
}: {
  db: UserDeviceDb;
  groupId: string;
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
      user: {
        groupMembers: {
          some: {
            groupId,
          },
        },
      },
    },
  });

  return mapRecipientPublicKeys(devices);
};

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
    },
  });

  if (!invite) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Invite not found" });
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
      groupId: invite.groupId,
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
      OR: [
        {
          user: {
            groupMembers: {
              some: {
                groupId: invite.groupId,
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
    groupId: invite.groupId,
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
    recipients: mapRecipientPublicKeys(devices),
    removedUserId: member.userId,
  };
};

export const persistGroupEpoch = async ({
  db,
  epoch,
  groupId,
  userId,
}: {
  db: GroupEpochPersistenceDb;
  epoch: {
    createdByDeviceId: string;
    epochId: string;
    epochNumber: number;
    recipientKeys: WrappedEpochKey[];
  };
  groupId: string;
  userId: string;
}) => {
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
    },
    where: {
      id: epoch.createdByDeviceId,
      revokedAt: null,
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

  for (const recipientKey of epoch.recipientKeys) {
    if (recipientKey.algorithm !== WRAPPED_EPOCH_KEY_ALGORITHM) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Unsupported wrapped epoch key algorithm.",
      });
    }

    if (recipientKey.epochId !== epoch.epochId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Wrapped epoch keys must target the same epoch.",
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

  await db.groupEpoch.create({
    data: {
      createdByDeviceId: epoch.createdByDeviceId,
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
      nonce: recipientKey.nonce,
      recipientDeviceId: recipientKey.recipientDeviceId,
      wrappedKey: recipientKey.wrappedKey,
    })),
  });
};

export const upsertUserDevice = async ({
  db,
  input,
  userId,
}: {
  db: UserDeviceDb;
  input: {
    algorithm: string;
    deviceId: string;
    publicKey: string;
  };
  userId: string;
}) => {
  if (input.algorithm !== DEVICE_KEY_ALGORITHM) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported device key algorithm." });
  }

  const existingDevice = await db.userDevice.findUnique({
    select: {
      userId: true,
    },
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
    return db.userDevice.update({
      data: {
        lastSeenAt: new Date(),
        publicKey: input.publicKey,
        publicKeyAlgorithm: input.algorithm,
        revokedAt: null,
      },
      where: {
        id: input.deviceId,
      },
    });
  }

  try {
    return await db.userDevice.create({
      data: {
        id: input.deviceId,
        publicKey: input.publicKey,
        publicKeyAlgorithm: input.algorithm,
        userId,
      },
    });
  } catch (error) {
    const conflictingDevice = await db.userDevice.findUnique({
      select: {
        userId: true,
      },
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

    throw error;
  }
};
