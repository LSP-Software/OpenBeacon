import type { RouterInputs } from "@openbeacon/api";
import {
  createInitialGroupEpoch,
  createNextGroupEpoch,
  type EpochCreator,
  type GroupEpoch,
  type RecipientPublicKeyMaterial,
} from "@openbeacon/encryption";
import { trpcClient } from "./api.ts";
import { createSecureId } from "./createSecureId.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

const createEpochBundle = ({
  creator,
  groupId,
  latestEpoch,
  recipients,
}: {
  creator: EpochCreator;
  groupId: string;
  latestEpoch: GroupEpoch | null;
  recipients: RecipientPublicKeyMaterial[];
}) => {
  if (latestEpoch) {
    const nextEpoch = createNextGroupEpoch({
      creator,
      previousEpoch: latestEpoch,
      recipients,
    });

    return {
      createdByDeviceId: creator.deviceId,
      epochId: nextEpoch.epoch.epochId,
      epochNumber: nextEpoch.epoch.epochNumber,
      recipientKeys: nextEpoch.wrappedKeys,
    };
  }

  const initialEpoch = createInitialGroupEpoch({
    creator,
    groupId,
    recipients,
  });

  return {
    createdByDeviceId: creator.deviceId,
    epochId: initialEpoch.epoch.epochId,
    epochNumber: initialEpoch.epoch.epochNumber,
    recipientKeys: initialEpoch.wrappedKeys,
  };
};

export const buildCreateGroupInput = async ({
  name,
}: {
  name: string;
}): Promise<RouterInputs["groupLifecycle"]["create"]> => {
  const deviceRegistration = await ensureDeviceKeyRegistration();
  const deviceKeyContext = await trpcClient.auth.deviceKeyContext.query();

  const groupId = createSecureId("group");
  const initialEpoch = createInitialGroupEpoch({
    creator: deviceRegistration,
    groupId,
    recipients: deviceKeyContext.recipients,
  });

  return {
    groupId,
    initialEpoch: {
      createdByDeviceId: deviceRegistration.deviceId,
      epochId: initialEpoch.epoch.epochId,
      epochNumber: initialEpoch.epoch.epochNumber,
      recipientKeys: initialEpoch.wrappedKeys,
    },
    name,
  };
};

export const buildAcceptInviteInput = async ({
  inviteId,
}: {
  inviteId: string;
}): Promise<RouterInputs["groupInvites"]["accept"]> => {
  const deviceRegistration = await ensureDeviceKeyRegistration();
  const acceptanceContext = await trpcClient.groupInvites.acceptanceContext.query({
    inviteId,
  });

  const nextEpoch = createEpochBundle({
    creator: deviceRegistration,
    groupId: acceptanceContext.groupId,
    latestEpoch: acceptanceContext.latestEpoch,
    recipients: acceptanceContext.recipients,
  });

  return {
    inviteId,
    nextEpoch,
  };
};

export const buildAcceptSharedInviteInput = async ({
  code,
}: {
  code: string;
}): Promise<RouterInputs["groupInvites"]["acceptShared"]> => {
  const deviceRegistration = await ensureDeviceKeyRegistration();
  const context = await trpcClient.groupInvites.sharedAcceptanceContext.mutate({ code });
  return {
    code,
    nextEpoch: createEpochBundle({
      creator: deviceRegistration,
      groupId: context.groupId,
      latestEpoch: context.latestEpoch,
      recipients: context.recipients,
    }),
  };
};

export const buildRemoveGroupMemberInput = async ({
  groupId,
  memberId,
}: {
  groupId: string;
  memberId: string;
}): Promise<RouterInputs["groupMembership"]["remove"]> => {
  const deviceRegistration = await ensureDeviceKeyRegistration();
  const removalContext = await trpcClient.groupMembership.removalContext.query({
    groupId,
    memberId,
  });

  return {
    groupId,
    memberId,
    nextEpoch: createEpochBundle({
      creator: deviceRegistration,
      groupId,
      latestEpoch: removalContext.latestEpoch,
      recipients: removalContext.recipients,
    }),
  };
};

export const rotateGroupEpochIfRequired = async (groupId: string) => {
  const context = await trpcClient.groupEpoch.rotationContext.query({ groupId });
  if (!context) return;
  const device = await ensureDeviceKeyRegistration();
  await trpcClient.groupEpoch.rotate.mutate({
    groupId,
    nextEpoch: createEpochBundle({
      creator: device,
      groupId,
      latestEpoch: context.latestEpoch,
      recipients: context.recipients,
    }),
  });
};
