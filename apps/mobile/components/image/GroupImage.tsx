import { File } from "expo-file-system";
import { tryCatch } from "@openbeacon/shared";
import { useMutation } from "@tanstack/react-query";
import { queryClient, trpc } from "../../lib/api.ts";
import { cleanupTempFile } from "../../lib/image-upload.ts";
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
  const uploadGroupImageMutation = useMutation(
    trpc.groupSettings.uploadGroupImage.mutationOptions(),
  );

  const uploadGroupImage = async (uri: string) => {
    const result = await tryCatch(
      (async () => {
        const image = await new File(uri).base64();
        return uploadGroupImageMutation.mutateAsync({ groupId, image });
      })(),
    );
    cleanupTempFile(uri);
    if (result.error) {
      return { error: "Unable to upload image" };
    }
    return { data: result.data.imageUrl };
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
      {...(editable ? { uploadImage: uploadGroupImage } : {})}
    />
  );
};
