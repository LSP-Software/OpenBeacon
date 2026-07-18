import { View } from "react-native";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";

export const LiveMapMarkerPin = ({
  image,
  initials,
  name,
  ringColor,
}: {
  image: string | null;
  initials: string;
  name: string;
  ringColor: string;
}) => {
  return (
    <View style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          borderWidth: 1,
          borderColor: "#FFFFFF",
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 3,
          elevation: 3,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            borderWidth: 3,
            borderColor: ringColor,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
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
  );
};
