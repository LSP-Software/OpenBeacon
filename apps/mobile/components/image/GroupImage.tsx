import { queryClient, trpc, trpcClient } from "../../lib/api.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { confirmGroupImage } from "../../lib/imageKeys.ts";
import { EditableImage } from "./EditableImage.tsx";

export const GroupImage = ({
  editable = true,
  groupId,
  imageUrl = null,
  size = "md",
}: {
  editable?: boolean;
  groupId: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) => {
  const uploadGroupImage = (uri: string) =>
    uploadImageFromUri({
      uri,
      ownerId: groupId,
      purpose: "group-image",
      request: () => trpcClient.groupSettings.requestGroupImageUpload.mutate({ groupId }),
      presign: (input) =>
        trpcClient.groupSettings.presignGroupImageUpload.mutate({ groupId, ...input }),
      confirm: ({ fileName, imageKey }) => confirmGroupImage({ fileName, groupId, imageKey }),
    });

  const handleGroupImageUploaded = async (uploadedImageUrl: string) => {
    queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (currentGroups) =>
      currentGroups?.map((group) =>
        group.id === groupId ? { ...group, image: uploadedImageUrl } : group,
      ),
    );
    await queryClient.invalidateQueries({ queryKey: trpc.groupMembership.list.queryKey() });
  };

  return (
    <EditableImage
      accessibilityLabel="Edit group photo"
      alt="Group avatar"
      imageUrl={imageUrl}
      onImageUploaded={handleGroupImageUploaded}
      size={size}
      {...(editable ? { uploadImage: uploadGroupImage } : {})}
    />
  );
};
