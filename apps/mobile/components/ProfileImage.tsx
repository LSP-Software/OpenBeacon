import { Image } from "expo-image";
import { PencilIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { useColors } from "../lib/theme.ts";

type ProfileImageProps = {
  imageUrl: string | null;
  size: number;
  onEditPress?: () => void;
  showEditButton?: boolean;
};

export function ProfileImage({
  imageUrl,
  size,
  onEditPress,
  showEditButton = false,
}: ProfileImageProps) {
  const colors = useColors();
  const editButtonSize = Math.round(size * 0.32);
  const editIconSize = Math.round(editButtonSize * 0.5);

  return (
    <View style={{ width: size, height: size }}>
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

      {showEditButton && onEditPress && (
        <Pressable
          onPress={onEditPress}
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
          }}
        >
          <PencilIcon size={editIconSize} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}
