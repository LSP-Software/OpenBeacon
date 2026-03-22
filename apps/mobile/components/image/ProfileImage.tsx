import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, trpc } from "../../lib/api.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { EditableImage } from "./EditableImage.tsx";

export const ProfileImage = ({
  imageUrl: imageUrlProp,
  showEditButton = false,
}: {
  imageUrl?: string | null;
  showEditButton?: boolean;
}) => {
  const { data: profile } = useQuery(trpc.account.getProfile.queryOptions());
  const requestProfileImageUploadMutation = useMutation(
    trpc.account.requestProfileImageUpload.mutationOptions(),
  );
  const confirmProfileImageUploadMutation = useMutation(
    trpc.account.confirmProfileImageUpload.mutationOptions(),
  );

  const imageUrl = imageUrlProp ?? profile?.image ?? null;

  const uploadProfileImage = async (uri: string) => {
    return uploadImageFromUri({
      uri,
      requestImageUpload: (input) => requestProfileImageUploadMutation.mutateAsync(input),
      confirmImageUpload: () => confirmProfileImageUploadMutation.mutateAsync(),
    });
  };

  const handleProfileImageUploaded = async (uploadedImageUrl: string) => {
    queryClient.setQueryData(trpc.account.getProfile.queryKey(), (currentProfile) =>
      currentProfile ? { ...currentProfile, image: uploadedImageUrl } : { image: uploadedImageUrl },
    );
  };

  return (
    <EditableImage
      accessibilityLabel="Edit profile picture"
      cropShape={"circle"}
      imageBorderRadius={999}
      imageUrl={imageUrl}
      onImageUploaded={handleProfileImageUploaded}
      showEditButton={showEditButton}
      uploadImage={uploadProfileImage}
    />
  );
};
