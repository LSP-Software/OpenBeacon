import { Image } from "expo-image";
import { PencilIcon } from "lucide-react-native";
import { cssInterop } from "nativewind";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useColors } from "../lib/theme.ts";

cssInterop(Image, { className: "style" });

const size = 80;
const editButtonSize = Math.round(size * 0.32);
const editIconSize = Math.round(editButtonSize * 0.5);

type ProfileImageProps = {
  imageUrl: string | null;
  onEditPress: () => void;
  showEditButton: boolean;
  isLoading: boolean;
};

export const ProfileImage = ({
  imageUrl,
  onEditPress,
  showEditButton = false,
  isLoading = false,
}: ProfileImageProps) => {
  const colors = useColors();

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

      {showEditButton && onEditPress && (
        <Pressable
          onPress={onEditPress}
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
