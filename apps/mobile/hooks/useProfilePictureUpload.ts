import { useMutation } from "@tanstack/react-query";
import { CryptoDigestAlgorithm, digest } from "expo-crypto";
import { File as ExpoFile } from "expo-file-system";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import ImagePicker from "react-native-image-crop-picker";
import { ApiError, apiPost } from "../lib/api.ts";

type RequestUploadResponse = {
  uploadUrl: string;
  authToken: string;
  fileName: string;
};

type ConfirmUploadResponse = {
  imageUrl: string;
};

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ensureFileUri(path: string): string {
  if (path.startsWith("file://")) return path;
  return `file://${path}`;
}

async function uploadProfilePicture(): Promise<string> {
  const picked = await ImagePicker.openPicker({
    mediaType: "photo",
    cropping: true,
    cropperCircleOverlay: true,
    width: 1024,
    height: 1024,
  });

  const manipulated = await manipulateAsync(
    ensureFileUri(picked.path),
    [{ resize: { width: 1024, height: 1024 } }],
    { format: SaveFormat.WEBP, compress: 0.85 },
  );

  const file = new ExpoFile(manipulated.uri);

  console.log("Requesting upload");

  try {
    const bytes = await file.bytes();
    const fileSize = file.size;
    const sha1Buffer = await digest(CryptoDigestAlgorithm.SHA1, bytes);
    const sha1 = arrayBufferToHex(sha1Buffer);

    const { uploadUrl, authToken, fileName } = await apiPost<RequestUploadResponse>(
      "/api/profile-picture/request-upload",
      { sha1, fileSize },
    );

    console.log("Upload URL:", uploadUrl);
    console.log("Auth token:", authToken);
    console.log("File name:", fileName);

    const b2Response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: authToken,
        "X-Bz-File-Name": fileName,
        "Content-Type": "image/webp",
        "Content-Length": String(fileSize),
        "X-Bz-Content-Sha1": sha1,
      },
      body: bytes,
    });

    console.log("B2 response:", b2Response);

    if (!b2Response.ok) {
      throw new ApiError(b2Response.status, "Failed to upload image. Please try again.");
    }

    console.log("Confirming upload");

    const { imageUrl } = await apiPost<ConfirmUploadResponse>(
      "/api/profile-picture/confirm-upload",
      { fileName },
    );

    console.log("Image URL:", imageUrl);

    return imageUrl;
  } finally {
    try {
      file.delete();
    } catch {}
    try {
      ImagePicker.cleanSingle(picked.path);
    } catch {}
  }
}

export function useProfilePictureUpload() {
  return useMutation({
    mutationFn: uploadProfilePicture,
  });
}
