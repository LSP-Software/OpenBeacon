import type { ImageCropShape } from "@openbeacon/shared";
import { Image } from "expo-image";
import { PencilIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { cleanupTempFile, pickAndCropImage, processImage } from "../../lib/image-upload.ts";
import { useColors } from "../../lib/theme.ts";
import { tryCatch } from "../../lib/tryCatch.ts";

cssInterop(Image, { className: "style" });

type EditableImageUploadResult =
  | { data: string | null; error?: never }
  | { data?: never; error: string };

type EditableImageProps = {
  accessibilityLabel: string;
  cropShape: ImageCropShape;
  imageBorderRadius: number;
  imageSize?: number;
  imageUrl?: string | null;
  maxResolution: number;
  onImageUploaded?: (imageUrl: string) => Promise<void> | void;
  showEditButton?: boolean;
  uploadImage: (uri: string) => Promise<EditableImageUploadResult>;
};

export const EditableImage = ({
  accessibilityLabel,
  cropShape,
  imageBorderRadius,
  imageSize = 80,
  imageUrl,
  maxResolution,
  onImageUploaded,
  showEditButton = false,
  uploadImage,
}: EditableImageProps) => {
  const colors = useColors();
  const [isUploading, setIsUploading] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const isLoading = isPickerOpen || isUploading;
  const editButtonSize = Math.round(imageSize * 0.32);
  const editIconSize = Math.round(editButtonSize * 0.5);

  const handleEditPress = async () => {
    if (isLoading) return;

    setIsPickerOpen(true);
    const pickResult = await pickAndCropImage(maxResolution, cropShape);
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
      processImage(pickResult.path, maxResolution),
    );
    cleanupTempFile(pickResult.path);

    if (processError) {
      Alert.alert("Image processing failed", processError.message);
      setIsUploading(false);
      return;
    }

    const { data: uploadedImageUrl, error: uploadError } = await uploadImage(processedUri);
    cleanupTempFile(processedUri);

    if (uploadError) {
      Alert.alert(`Upload failed: ${uploadError}`);
      setIsUploading(false);
      return;
    }

    if (uploadedImageUrl && onImageUploaded) {
      const { error: callbackError } = await tryCatch(
        Promise.resolve(onImageUploaded(uploadedImageUrl)),
      );
      if (callbackError) {
        Alert.alert("Failed to update image", callbackError.message);
      }
    }

    setIsUploading(false);
  };

  return (
    <View style={{ height: imageSize, position: "relative", width: imageSize }}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ borderRadius: imageBorderRadius, height: imageSize, width: imageSize }}
          cachePolicy="disk"
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          className="bg-surface border border-border"
          style={{ borderRadius: imageBorderRadius, height: imageSize, width: imageSize }}
        />
      )}

      {isLoading && (
        <View
          pointerEvents="none"
          className="absolute inset-0 bg-black/30 items-center justify-center"
          style={{ borderRadius: imageBorderRadius }}
        >
          <ActivityIndicator color={colors.onPrimary} />
        </View>
      )}

      {showEditButton && (
        <Pressable
          onPress={handleEditPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          className={`absolute bottom-0 right-0 rounded-full bg-primary items-center justify-center border-2 border-background ${isLoading ? "opacity-70" : ""}`}
          style={{ height: editButtonSize, width: editButtonSize }}
        >
          <PencilIcon size={editIconSize} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
};
