import { Image } from "expo-image";
import { PencilIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useColors } from "../lib/theme.ts";

type ProfileImageProps = {
  imageUrl: string | null;
  onEditPress: () => void;
  showEditButton: boolean;
  isLoading: boolean;
};

export function ProfileImage({
  imageUrl,
  onEditPress,
  showEditButton = false,
  isLoading = false,
}: ProfileImageProps) {
  const size = 80;
  const colors = useColors();
  const editButtonSize = Math.round(size * 0.32);
  const editIconSize = Math.round(editButtonSize * 0.5);

  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      {imageUrl ? (
        <Image
          source={{ uri: imageUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          cachePolicy="disk"
          contentFit="cover"
          transition={200}
        />
      ) : (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        />
      )}

      {isLoading && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: size / 2,
            backgroundColor: "rgba(0,0,0,0.3)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color={colors.onPrimary} />
        </View>
      )}

      {showEditButton && onEditPress && (
        <Pressable
          onPress={onEditPress}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Edit profile picture"
          style={{
            position: "absolute",
            bottom: 0,
            right: 0,
            width: editButtonSize,
            height: editButtonSize,
            borderRadius: editButtonSize / 2,
            backgroundColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 2,
            borderColor: colors.background,
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          <PencilIcon size={editIconSize} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}
