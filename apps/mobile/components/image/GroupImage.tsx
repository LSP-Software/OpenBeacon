import { showUploadedGroupImage, uploadGroupImage } from "../../lib/groupImageUpload.ts";
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
}) => (
  <EditableImage
    accessibilityLabel="Edit group picture"
    alt="Group avatar"
    imageUrl={imageUrl}
    onImageUploaded={(uploadedImageUrl) =>
      showUploadedGroupImage({ groupId, imageUrl: uploadedImageUrl })
    }
    size={size}
    {...(editable ? { uploadImage: (uri: string) => uploadGroupImage({ groupId, uri }) } : {})}
  />
);
