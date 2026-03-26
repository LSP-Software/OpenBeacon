import type { RouterInputs } from "@openbeacon/api";
import {
  createInitialGroupEpoch,
  createNextGroupEpoch,
  type GroupEpoch,
  type RecipientPublicKeyMaterial,
} from "@openbeacon/encryption";
import { trpcClient } from "./api.ts";
import { createSecureId } from "./createSecureId.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

const createEpochBundle = ({
  currentDeviceId,
  groupId,
  latestEpoch,
  recipients,
}: {
  currentDeviceId: string;
  groupId: string;
  latestEpoch: GroupEpoch | null;
  recipients: RecipientPublicKeyMaterial[];
}) => {
  if (latestEpoch) {
    const nextEpoch = createNextGroupEpoch({
      createdByDeviceId: currentDeviceId,
      previousEpoch: latestEpoch,
      recipients,
    });

    return {
      createdByDeviceId: nextEpoch.epoch.createdByDeviceId,
      epochId: nextEpoch.epoch.epochId,
      epochNumber: nextEpoch.epoch.epochNumber,
      recipientKeys: nextEpoch.wrappedKeys,
    };
  }

  const initialEpoch = createInitialGroupEpoch({
    createdByDeviceId: currentDeviceId,
    groupId,
    recipients,
  });

  return {
    createdByDeviceId: initialEpoch.epoch.createdByDeviceId,
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
    createdByDeviceId: deviceRegistration.deviceId,
    groupId,
    recipients: deviceKeyContext.recipients,
  });

  return {
    groupId,
    initialEpoch: {
      createdByDeviceId: initialEpoch.epoch.createdByDeviceId,
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
    currentDeviceId: deviceRegistration.deviceId,
    groupId: acceptanceContext.groupId,
    latestEpoch: acceptanceContext.latestEpoch,
    recipients: acceptanceContext.recipients,
  });

  return {
    inviteId,
    nextEpoch,
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
      currentDeviceId: deviceRegistration.deviceId,
      groupId,
      latestEpoch: removalContext.latestEpoch,
      recipients: removalContext.recipients,
    }),
  };
};
