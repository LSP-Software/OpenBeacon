import { useState } from "react";
import { trpcClient } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";
import { uploadImageFromUri } from "../../lib/image-upload.ts";
import { confirmProfileImage } from "../../lib/imageKeys.ts";
import { EditableImage } from "./EditableImage.tsx";

export const ProfileImage = ({ imageUrl }: { imageUrl?: string | null }) => {
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const { data: session, refetch } = authClient.useSession();
  const userId = session?.user?.id;

  const uploadProfileImage = async (uri: string) => {
    if (!userId) return { error: "Sign in again to change your picture." };
    return uploadImageFromUri({
      uri,
      ownerId: userId,
      purpose: "profile-image",
      request: () => trpcClient.account.requestProfileImageUpload.mutate(),
      presign: (input) => trpcClient.account.presignProfileImageUpload.mutate(input),
      confirm: ({ fileName, imageKey }) => confirmProfileImage({ fileName, imageKey, userId }),
    });
  };

  const handleProfileImageUploaded = async (uploadedImageUrl: string) => {
    setUploadedImageUrl(uploadedImageUrl);
    await refetch();
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
