import { useMutation, useQuery } from "@tanstack/react-query";
import { File as FSFile } from "expo-file-system";
import { Image } from "expo-image";
import { PencilIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { queryClient, trpc } from "../lib/api.ts";
import {
  cleanupTempFile,
  computeSha256Base64,
  pickAndCropImage,
  processImage,
  uploadToPresignedUrl,
} from "../lib/image-upload.ts";
import { useColors } from "../lib/theme.ts";
import { tryCatch } from "../lib/tryCatch.ts";

cssInterop(Image, { className: "style" });

const size = 80;
const editButtonSize = Math.round(size * 0.32);
const editIconSize = Math.round(editButtonSize * 0.5);
const MAX_PFP_IMAGE_RESOLUTION = 512;

type ProfileImageProps = {
  imageUrl?: string | null;
  showEditButton?: boolean;
};

export const ProfileImage = ({
  imageUrl: imageUrlProp,
  showEditButton = false,
}: ProfileImageProps) => {
  const colors = useColors();
  const { data: profile } = useQuery(trpc.account.getProfile.queryOptions());
  const requestUploadMutation = useMutation(trpc.account.requestImageUpload.mutationOptions());
  const confirmUploadMutation = useMutation(trpc.account.confirmImageUpload.mutationOptions());
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const imageUrl = imageUrlProp ?? profile?.image ?? null;
  const isLoading = isPickerOpen || isUploading;

  type Result<T, E = string> = { data: T; error?: never } | { data?: never; error: E };

  const uploadProfilePhoto = async (uri: string): Promise<Result<string | null>> => {
    const file = new FSFile(uri);
    const { data: bytes, error: readError } = await tryCatch(
      (async () => {
        const b = await file.bytes();
        return b.slice().buffer;
      })(),
    );
    if (readError) return { error: `Unable to read image bytes: ${readError.message}` };

    const fileSize = bytes.byteLength;

    const { data: contentHash, error: hashError } = await tryCatch(computeSha256Base64(bytes));
    if (hashError) return { error: `Unable to compute content hash: ${hashError.message}` };

    const { data: uploadData, error: requestError } = await tryCatch(
      requestUploadMutation.mutateAsync({ fileSize, contentHash }),
    );
    if (requestError) return { error: `Unable to request upload: ${requestError.message}` };

    const { error: uploadError } = await tryCatch(
      uploadToPresignedUrl(uploadData.presignedUrl, bytes, contentHash),
    );
    if (uploadError) return { error: `Unable to upload image: ${uploadError.message}` };

    const { data: confirmData, error: confirmError } = await tryCatch(
      confirmUploadMutation.mutateAsync(),
    );
    if (confirmError) return { error: `Unable to confirm upload: ${confirmError.message}` };

    return { data: confirmData.imageUrl };
  };

  const handleEditPress = async () => {
    if (isUploading || isPickerOpen) return;

    setIsPickerOpen(true);
    const pickResult = await pickAndCropImage(MAX_PFP_IMAGE_RESOLUTION);
    setIsPickerOpen(false);
    if (pickResult.ok) {
      setIsUploading(true);
    } else if ("cancelled" in pickResult) {
      return;
    } else {
      Alert.alert("Image selection failed", pickResult.error.message);
      return;
    }

    const { data: processedUri, error: processError } = await tryCatch(
      processImage(pickResult.path, MAX_PFP_IMAGE_RESOLUTION),
    );
    cleanupTempFile(pickResult.path);
    if (processError) {
      Alert.alert("Image processing failed", processError.message);
      setIsUploading(false);
      return;
    }

    const { data: imageUrl, error: uploadError } = await uploadProfilePhoto(processedUri);
    cleanupTempFile(processedUri);
    if (uploadError) {
      Alert.alert(`Upload failed: ${uploadError}`);
      setIsUploading(false);
      return;
    }

    if (imageUrl) {
      await queryClient.setQueryData(trpc.account.getProfile.queryKey(), { image: imageUrl });
    }
    setIsUploading(false);
  };

  return (
    <View className="w-20 h-20 relative">
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          className="w-20 h-20 rounded-full"
          cachePolicy="disk"
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View className="w-20 h-20 rounded-full bg-surface border border-border" />
      )}

      {isLoading && (
        <View
          pointerEvents="none"
          className="absolute inset-0 rounded-full bg-black/30 items-center justify-center"
        >
          <ActivityIndicator color={colors.onPrimary} />
        </View>
      )}

      {showEditButton && (
        <Pressable
          onPress={handleEditPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Edit profile picture"
          className={`absolute bottom-0 right-0 w-[26px] h-[26px] rounded-full bg-primary items-center justify-center border-2 border-background ${isLoading ? "opacity-70" : ""}`}
        >
          <PencilIcon size={editIconSize} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
};
