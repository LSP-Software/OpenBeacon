import { useMutation } from "@tanstack/react-query";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { EditableImage } from "./EditableImage.tsx";

export const ProfileImage = ({
  showEditButton = false,
}: {
  imageUrl?: string | null;
  showEditButton?: boolean;
}) => {
  const { data: session, refetch: refetchSession } = authClient.useSession();
  const requestProfileImageUploadMutation = useMutation(
    trpc.account.requestProfileImageUpload.mutationOptions(),
  );
  const confirmProfileImageUploadMutation = useMutation(
    trpc.account.confirmProfileImageUpload.mutationOptions(),
  );

  const uploadProfileImage = async (uri: string) => {
    return uploadImageFromUri({
      uri,
      requestImageUpload: (input) => requestProfileImageUploadMutation.mutateAsync(input),
      confirmImageUpload: () => confirmProfileImageUploadMutation.mutateAsync(),
    });
  };

  const handleProfileImageUploaded = async () => {
    refetchSession();
  };

  return (
    <EditableImage
      accessibilityLabel="Edit profile picture"
      alt="Profile avatar"
      imageUrl={session?.user.image ?? null}
      onImageUploaded={handleProfileImageUploaded}
      showEditButton={showEditButton}
      uploadImage={uploadProfileImage}
    />
  );
};
