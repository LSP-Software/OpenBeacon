import { tryCatch } from "@openbeacon/shared";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { PencilIcon, UserIcon } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import type { ImageUploadResult } from "../../lib/image-upload.ts";
import { cleanupTempFile } from "../../lib/image-upload.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Icon } from "../ui/Icon.tsx";

interface EditableImageProps {
  accessibilityLabel: string;
  imageUrl?: string | null;
  onImageUploaded?: (imageUrl: string) => Promise<void> | void;
  showEditButton?: boolean;
  size?: "sm" | "md" | "lg";
  uploadImage?: (uri: string) => Promise<ImageUploadResult>;
  alt: string;
}

export const EditableImage = ({
  accessibilityLabel,
  imageUrl,
  onImageUploaded,
  size = "md",
  uploadImage,
  alt,
}: EditableImageProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isLoading = isUploading;
  const sizeClassNames = {
    sm: {
      avatar: "size-16",
      fallbackIcon: "size-5",
      editButton: "size-6 border",
      editIcon: "size-3",
    },
    md: {
      avatar: "size-24",
      fallbackIcon: "size-6",
      editButton: "size-8 border-2",
      editIcon: "size-4",
    },
    lg: {
      avatar: "size-32",
      fallbackIcon: "size-8",
      editButton: "size-10 border-2",
      editIcon: "size-5",
    },
  } as const;

  const pickAndCropImage = async (): Promise<{ ok: true; path: string } | undefined> => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert("Permission required", "Permission to access the media library is required.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
      allowsMultipleSelection: false,
      exif: false,
      shape: "oval",
    });

    if (result.canceled) {
      return;
    }

    const photo = result.assets[0];
    if (!photo) {
      Alert.alert("No photo selected");
      return;
    }

    return { ok: true, path: photo.uri };
  };

  const processImage = async (uri: string): Promise<string> => {
    try {
      const context = ImageManipulator.manipulate(uri);
      const imageRef = await context.resize({ width: 512, height: 512 }).renderAsync();
      const result = await imageRef.saveAsync({ format: SaveFormat.WEBP, compress: 0.85 });
      return result.uri;
    } finally {
      cleanupTempFile(uri);
    }
  };

  const handleEditPress = async () => {
    if (isLoading || pickerOpen || !uploadImage) return;
    setPickerOpen(true);

    try {
      const pickResult = await pickAndCropImage();
      if (!pickResult) return;
      setIsUploading(true);

      const { data: processedUri, error: processError } = await tryCatch(
        processImage(pickResult.path),
      );
      if (processError) {
        Alert.alert("Image processing failed", processError.message);
        return;
      }

      const uploadResult = await uploadImage(processedUri);
      if ("error" in uploadResult) {
        Alert.alert("Upload failed", uploadResult.error);
        return;
      }

      if (onImageUploaded) {
        const { error: callbackError } = await tryCatch(
          Promise.resolve(onImageUploaded(uploadResult.data)),
        );
        if (callbackError) {
          Alert.alert("Failed to update image", callbackError.message);
        }
      }
    } catch (error) {
      Alert.alert("Upload failed", error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploading(false);
      setPickerOpen(false);
    }
  };

  return (
    <View>
      <Avatar alt={alt} className={cn(sizeClassNames[size].avatar, "border-2 border-white")}>
        <AvatarImage source={{ uri: imageUrl ?? "" }} />
        <AvatarFallback>
          <Icon
            as={UserIcon}
            className={cn(sizeClassNames[size].fallbackIcon, "text-primary-foreground")}
          />
        </AvatarFallback>
      </Avatar>

      {isLoading && (
        <View
          pointerEvents="none"
          className="absolute inset-0 bg-black/30 items-center justify-center rounded-full"
        >
          <ActivityIndicator className="text-primary" />
        </View>
      )}

      {uploadImage !== undefined && (
        <Pressable
          onPress={handleEditPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          className={`absolute bottom-0 right-0 rounded-full bg-primary items-center justify-center border-background ${sizeClassNames[size].editButton} ${isLoading ? "opacity-70" : ""}`}
        >
          <Icon as={PencilIcon} className={`${sizeClassNames[size].editIcon} text-white`} />
        </Pressable>
      )}
    </View>
  );
};
