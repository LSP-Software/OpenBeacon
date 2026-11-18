import { Alert } from "../../lib/alert.ts";
import { tryCatch } from "@openbeacon/shared";
import { type LucideIcon, PencilIcon, UserIcon } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import type { ImageUploadResult } from "../../lib/image-upload.ts";
import { pickImage, processImage } from "../../lib/pickImage.ts";
import { DecryptedAvatarImage } from "./DecryptedAvatarImage.tsx";
import { Avatar, AvatarFallback } from "../ui/Avatar.tsx";
import { Icon } from "../ui/Icon.tsx";

interface EditableImageProps {
  accessibilityLabel: string;
  imageUrl?: string | null;
  onImageUploaded?: (imageUrl: string) => Promise<void> | void;
  showEditButton?: boolean;
  size?: "sm" | "md" | "lg";
  uploadImage?: (uri: string) => Promise<ImageUploadResult>;
  alt: string;
  fallbackIcon?: LucideIcon;
}

export const EditableImage = ({
  accessibilityLabel,
  imageUrl,
  onImageUploaded,
  size = "md",
  uploadImage,
  alt,
  fallbackIcon = UserIcon,
}: EditableImageProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isLoading = isUploading;
  const sizeClassNames = {
    sm: {
      avatar: "size-16",
      fallbackIcon: "size-5",
      editButton: "size-7 border",
      editIcon: "size-3.5",
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

  const handleEditPress = async () => {
    if (isLoading || pickerOpen || !uploadImage) return;
    setPickerOpen(true);

    try {
      const pickedUri = await pickImage();
      if (!pickedUri) return;
      setIsUploading(true);

      const processedUri = await processImage(pickedUri);
      if (!processedUri) return;

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
          Alert.alert("Unable to update the picture", callbackError.message);
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
      <Avatar alt={alt} className={sizeClassNames[size].avatar}>
        <DecryptedAvatarImage url={imageUrl} />
        <AvatarFallback>
          <Icon
            as={fallbackIcon}
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
          className={`absolute -bottom-1 -right-1 items-center justify-center rounded-full border-border bg-card ${sizeClassNames[size].editButton} ${isLoading ? "opacity-70" : ""}`}
        >
          <Icon as={PencilIcon} className={`${sizeClassNames[size].editIcon} text-foreground`} />
        </Pressable>
      )}
    </View>
  );
};
