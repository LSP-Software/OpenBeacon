import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { PencilIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import ImageCropPicker from "react-native-image-crop-picker";
import { cleanupTempFile } from "../../lib/image-upload.ts";
import { useColors } from "../../lib/theme.ts";
import { tryCatch } from "../../lib/tryCatch.ts";

const DEFAULT_IMAGE_SIZE = 1024;
const IMAGE_QUALITY = 0.85;

cssInterop(Image, { className: "style" });

type ImageCropShape = "circle" | "rectangle";

type EditableImageProps = {
  accessibilityLabel: string;
  cropShape: ImageCropShape;
  imageBorderRadius: number;
  imageSize?: number;
  imageUrl?: string | null;
  maxResolution: number;
  onImageUploaded?: (imageUrl: string) => Promise<void> | void;
  showEditButton?: boolean;
  uploadImage: (
    uri: string,
  ) => Promise<{ data: string | null; error?: never } | { data?: never; error: string }>;
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

  const pickAndCropImage = async (
    size: number = DEFAULT_IMAGE_SIZE,
    cropShape: ImageCropShape = "circle",
  ): Promise<
    { ok: true; path: string } | { ok: false; cancelled: true } | { ok: false; error: Error }
  > => {
    const { data: image, error } = await tryCatch(
      ImageCropPicker.openPicker({
        cropping: true,
        cropperCircleOverlay: cropShape === "circle",
        width: size,
        height: size,
        mediaType: "photo",
      }),
    );

    if (!error) {
      return { ok: true, path: image.path };
    }
    if (error.message.includes("User cancelled")) {
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: new Error(String(error)) };
  };

  const processImage = async (uri: string, size: number = DEFAULT_IMAGE_SIZE): Promise<string> => {
    const context = ImageManipulator.manipulate(uri);
    const imageRef = await context.resize({ width: size, height: size }).renderAsync();
    const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: IMAGE_QUALITY });
    return result.uri;
  };

  const handleEditPress = async () => {
    if (isLoading) return;

    setIsPickerOpen(true);
    const pickResult = await pickAndCropImage(maxResolution, cropShape);
    setIsPickerOpen(false);

    if ("cancelled" in pickResult) return;
    if (!pickResult.ok) {
      Alert.alert("Image selection failed", pickResult.error.message);
      return;
    }
    setIsUploading(true);

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
      Alert.alert("Upload failed", uploadError);
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
