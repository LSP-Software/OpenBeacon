import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { trpc } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { EditableImage } from "./EditableImage.tsx";

export const ProfileImage = ({ imageUrl }: { imageUrl?: string | null }) => {
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const { data: session } = authClient.useSession();
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

  const handleProfileImageUploaded = async (uploadedImageUrl: string) => {
    setUploadedImageUrl(uploadedImageUrl);
  };

  return (
    <EditableImage
      accessibilityLabel="Edit profile picture"
      alt="Profile avatar"
      imageUrl={uploadedImageUrl ?? session?.user?.image ?? imageUrl ?? null}
      onImageUploaded={handleProfileImageUploaded}
      uploadImage={uploadProfileImage}
    />
  );
};
