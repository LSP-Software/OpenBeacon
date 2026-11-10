import type { RouterInputs } from "@openbeacon/api";
import {
  createInitialGroupEpoch,
  createNextGroupEpoch,
  type EpochCreator,
  type GroupEpoch,
  type HistoryPublicKey,
  type RecipientPublicKeyMaterial,
  wrapEpochKeyForHistoryKey,
} from "@openbeacon/encryption";
import { HISTORY_RECIPIENT_MISMATCH_MESSAGE } from "@openbeacon/schemas";
import { tryCatch } from "@openbeacon/shared";
import { TRPCClientError } from "@trpc/client";
import { trpcClient } from "./api.ts";
import { createSecureId } from "./createSecureId.ts";
import { ensureDeviceKeyRegistration } from "./deviceKeys.ts";

const createEpochBundle = ({
  creator,
  groupId,
  historyRecipients,
  latestEpoch,
  recipients,
}: {
  creator: EpochCreator;
  groupId: string;
  historyRecipients: HistoryPublicKey[];
  latestEpoch: GroupEpoch | null;
  recipients: RecipientPublicKeyMaterial[];
}) => {
  const { epoch, epochKey, wrappedKeys } = latestEpoch
    ? createNextGroupEpoch({ creator, previousEpoch: latestEpoch, recipients })
    : createInitialGroupEpoch({ creator, groupId, recipients });

  return {
    createdByDeviceId: creator.deviceId,
    epochId: epoch.epochId,
    epochNumber: epoch.epochNumber,
    historyKeys: historyRecipients.map((historyKey) =>
      wrapEpochKeyForHistoryKey({
        epochId: epoch.epochId,
        epochKey,
        historyKey,
        senderPrivateKey: creator.privateKey,
      }),
    ),
    recipientKeys: wrappedKeys,
  };
};

export const submitEpochChange = async <Input, Output>({
  build,
  submit,
}: {
  build: () => Promise<Input>;
  submit: (input: Input) => Promise<Output>;
}) => {
  const result = await tryCatch(submit(await build()));
  if (!result.error) return result.data;
  if (
    !(result.error instanceof TRPCClientError) ||
    result.error.message !== HISTORY_RECIPIENT_MISMATCH_MESSAGE
  ) {
    throw result.error;
  }
  return submit(await build());
};

export const buildCreateGroupInput = async ({
  name,
}: {
  name: string;
}): Promise<RouterInputs["groupLifecycle"]["create"]> => {
  const deviceRegistration = await ensureDeviceKeyRegistration();
  const deviceKeyContext = await trpcClient.auth.deviceKeyContext.query();

  const groupId = createSecureId("group");

  return {
    groupId,
    initialEpoch: createEpochBundle({
      creator: deviceRegistration,
      groupId,
      historyRecipients: deviceKeyContext.historyRecipients,
      latestEpoch: null,
      recipients: deviceKeyContext.recipients,
    }),
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
    historyRecipients: acceptanceContext.historyRecipients,
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
      historyRecipients: context.historyRecipients,
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
      historyRecipients: removalContext.historyRecipients,
      latestEpoch: removalContext.latestEpoch,
      recipients: removalContext.recipients,
    }),
  };
};

export const rotateGroupEpochIfRequired = async (groupId: string) =>
  submitEpochChange({
    build: async () => {
      const context = await trpcClient.groupEpoch.rotationContext.query({ groupId });
      if (!context) return null;
      const device = await ensureDeviceKeyRegistration();
      return {
        groupId,
        nextEpoch: createEpochBundle({
          creator: device,
          groupId,
          historyRecipients: context.historyRecipients,
          latestEpoch: context.latestEpoch,
          recipients: context.recipients,
        }),
      };
    },
    submit: async (input) => {
      if (!input) return false;
      return (await trpcClient.groupEpoch.rotate.mutate(input)).rotated;
    },
  });
