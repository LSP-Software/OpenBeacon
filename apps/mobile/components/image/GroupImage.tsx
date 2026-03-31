import { useMutation } from "@tanstack/react-query";
import { queryClient, trpc } from "../../lib/api.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { EditableImage } from "./EditableImage.tsx";

export const GroupImage = ({
  groupId,
  imageUrl = null,
  size = "md",
}: {
  groupId: string;
  imageUrl?: string | null;
  size?: "sm" | "md" | "lg";
}) => {
  const requestGroupImageUploadMutation = useMutation(
    trpc.groupSettings.requestGroupImageUpload.mutationOptions(),
  );
  const confirmGroupImageUploadMutation = useMutation(
    trpc.groupSettings.confirmGroupImageUpload.mutationOptions(),
  );

  const uploadGroupImage = async (uri: string) => {
    return uploadImageFromUri({
      uri,
      requestImageUpload: (input) =>
        requestGroupImageUploadMutation.mutateAsync({ groupId, ...input }),
      confirmImageUpload: () => confirmGroupImageUploadMutation.mutateAsync({ groupId }),
    });
  };

  const handleGroupImageUploaded = async (uploadedImageUrl: string) => {
    queryClient.setQueryData(trpc.groupMembership.list.queryKey(), (currentGroups) =>
      currentGroups?.map((group) =>
        group.id === groupId ? { ...group, image: uploadedImageUrl } : group,
      ),
    );
    queryClient.setQueryData(trpc.groupMembership.get.queryKey({ groupId }), (currentGroup) =>
      currentGroup ? { ...currentGroup, image: uploadedImageUrl } : currentGroup,
    );
  };

  return (
    <EditableImage
      accessibilityLabel="Edit group photo"
      alt="Group avatar"
      imageUrl={imageUrl}
      onImageUploaded={handleGroupImageUploaded}
      size={size}
      uploadImage={uploadGroupImage}
    />
  );
};
