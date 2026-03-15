export const ImageContentType = "image/webp";
export const ImageFileExtension = "webp";

export type ImageCropShape = "circle" | "rectangle";

export type ImageUploadRequestInput = {
  fileSize: number;
  contentHash: string;
};

export type ImageUploadRequestResult = {
  presignedUrl: string;
};

export type ImageUploadConfirmResult = {
  imageUrl: string | null;
};

export const ProfileImageConfig = {
  cropShape: "circle" as const,
  maxResolution: 512,
};

export const GroupImageConfig = {
  cropShape: "rectangle" as const,
  maxResolution: 512,
};
