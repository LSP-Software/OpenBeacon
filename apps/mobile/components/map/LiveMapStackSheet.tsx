import { Pressable, ScrollView, View } from "react-native";
import { useTimeSince } from "../../hooks/useTimeSince.ts";
import type { LiveMapMarker } from "../../lib/buildLiveMapMarkers.ts";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/Avatar.tsx";
import { Text } from "../ui/Text.tsx";
import { LiveMapBottomSheet } from "./LiveMapBottomSheet.tsx";

const StackSheetRow = ({ marker, onPress }: { marker: LiveMapMarker; onPress: () => void }) => {
  const updatedAge = useTimeSince(marker.timestamp);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${marker.name}`}
      className="flex-row items-center gap-3 py-2 active:opacity-70"
      onPress={onPress}
    >
      <Avatar alt={marker.name} className="size-11">
        {marker.image ? <AvatarImage source={{ uri: marker.image }} /> : null}
        <AvatarFallback>
          <Text className="font-bold">{marker.initials}</Text>
        </AvatarFallback>
      </Avatar>
      <View className="min-w-0 flex-1">
        <Text className="text-foreground font-semibold" numberOfLines={1}>
          {marker.isSelf ? `${marker.name} (you)` : marker.name}
        </Text>
        <Text className="text-muted text-sm">
          {updatedAge === null ? "No location sent yet" : `Updated ${updatedAge}`}
        </Text>
      </View>
    </Pressable>
  );
};

export const LiveMapStackSheet = ({
  members,
  onDismiss,
  onHeightChange,
  onSelectUser,
}: {
  members: readonly LiveMapMarker[];
  onDismiss: () => void;
  onHeightChange: (height: number) => void;
  onSelectUser: (userId: string) => void;
}) => (
  <LiveMapBottomSheet
    accessibilityLabel={`${members.length} people here`}
    header={
      <Text className="text-foreground mb-1 text-xl font-bold">{members.length} people here</Text>
    }
    onDismiss={onDismiss}
    onHeightChange={onHeightChange}
  >
    <ScrollView style={{ maxHeight: 300 }} bounces={false} overScrollMode="never">
      {members.map((marker) => (
        <StackSheetRow
          key={marker.userId}
          marker={marker}
          onPress={() => onSelectUser(marker.userId)}
        />
      ))}
    </ScrollView>
  </LiveMapBottomSheet>
);
