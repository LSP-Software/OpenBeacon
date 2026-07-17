import { Pressable, View } from "react-native";
import { useColors } from "../../lib/theme.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";

const HALO_SIZES = [64, 54, 44] as const;
const HALO_OPACITIES = [0.12, 0.2, 0.32] as const;

export const LiveMapMarkerPin = ({
  image,
  initials,
  isSelf,
  name,
  onPress,
  ringColor,
}: {
  image: string | null;
  initials: string;
  isSelf: boolean;
  name: string;
  onPress: () => void;
  ringColor: string;
}) => {
  const colors = useColors();

  return (
    <Pressable onPress={onPress} hitSlop={8}>
      <View className="items-center justify-center" style={{ width: 68, height: 68 }}>
        {isSelf
          ? HALO_SIZES.map((size, index) => (
              <View
                key={size}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: 1.5,
                  borderColor: colors.primary,
                  opacity: HALO_OPACITIES[index],
                }}
              />
            ))
          : null}
        <View
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#FFFFFF",
            shadowColor: "#000000",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.2,
            shadowRadius: 3,
            elevation: 3,
          }}
        >
          <View
            style={{
              borderRadius: 999,
              borderWidth: 3,
              borderColor: ringColor,
              overflow: "hidden",
            }}
          >
            <Avatar alt={name} className="size-10">
              {image ? <AvatarImage source={{ uri: image }} /> : null}
              <AvatarFallback>
                <Text className="font-bold">{initials}</Text>
              </AvatarFallback>
            </Avatar>
          </View>
        </View>
      </View>
    </Pressable>
  );
};
