import { tryCatch } from "@openbeacon/shared";
import { Alert } from "./alert.ts";
import { queryClient, trpc, trpcClient } from "./api.ts";
import {
  type ImageUploadResult,
  imageUploadErrorMessage,
  uploadImageFromUri,
} from "./image-upload.ts";
import { confirmGroupImage } from "./imageKeys.ts";

export const uploadGroupImage = ({ groupId, uri }: { groupId: string; uri: string }) =>
  uploadImageFromUri({
    uri,
    ownerId: groupId,
    purpose: "group-image",
    request: () => trpcClient.groupSettings.requestGroupImageUpload.mutate({ groupId }),
    presign: (input) =>
      trpcClient.groupSettings.presignGroupImageUpload.mutate({ groupId, ...input }),
    confirm: ({ fileName, imageKey }) => confirmGroupImage({ fileName, groupId, imageKey }),
  });

export const showUploadedGroupImage = async ({
  groupId,
  imageUrl,
}: {
  groupId: string;
  imageUrl: string;
}) => {
  queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (currentGroups) =>
    currentGroups?.map((group) => (group.id === groupId ? { ...group, image: imageUrl } : group)),
  );
  await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
};

export const uploadNewGroupImage = async ({ groupId, uri }: { groupId: string; uri: string }) => {
  const upload = await tryCatch(uploadGroupImage({ groupId, uri }));
  const result: ImageUploadResult = upload.error
    ? { error: imageUploadErrorMessage(upload.error) }
    : upload.data;
  if (result.error !== undefined) {
    Alert.alert(
      "Group created, but the picture couldn’t be uploaded",
      `${result.error} You can set it from the group screen.`,
    );
    return;
  }
  await tryCatch(showUploadedGroupImage({ groupId, imageUrl: result.data }));
};
