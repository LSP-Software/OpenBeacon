import { GroupImageConfig } from "@openbeacon/shared";
import { useMutation } from "@tanstack/react-query";
import { queryClient, trpc } from "../lib/api.ts";
import { uploadImageFromUri } from "../lib/image-upload.ts";
import { EditableImage } from "./EditableImage.tsx";

type GroupImageProps = {
  groupId: string;
  imageUrl?: string | null;
  showEditButton?: boolean;
};

export const GroupImage = ({
  groupId,
  imageUrl = null,
  showEditButton = false,
}: GroupImageProps) => {
  const requestGroupImageUploadMutation = useMutation(
    trpc.groups.requestGroupImageUpload.mutationOptions(),
  );
  const confirmGroupImageUploadMutation = useMutation(
    trpc.groups.confirmGroupImageUpload.mutationOptions(),
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
    queryClient.setQueryData(trpc.groups.list.queryKey(), (currentGroups) =>
      currentGroups?.map((group) =>
        group.id === groupId ? { ...group, image: uploadedImageUrl } : group,
      ),
    );
  };

  return (
    <EditableImage
      accessibilityLabel="Edit group photo"
      cropShape={GroupImageConfig.cropShape}
      imageBorderRadius={24}
      imageUrl={imageUrl}
      maxResolution={GroupImageConfig.maxResolution}
      onImageUploaded={handleGroupImageUploaded}
      showEditButton={showEditButton}
      uploadImage={uploadGroupImage}
    />
  );
};
