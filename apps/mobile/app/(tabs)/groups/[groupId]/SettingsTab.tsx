import { View } from "react-native";
import { GroupMapColorPicker } from "../../../../components/map/GroupMapColorPicker.tsx";
import { Text } from "../../../../components/ui/Text.tsx";

const SettingsTab = ({ groupId }: { groupId: string }) => {
  return (
    <View className="gap-3 pt-1">
      <Text className="mb-1 text-lg font-medium text-muted-foreground">Appearance</Text>
      <GroupMapColorPicker groupId={groupId} />
    </View>
  );
};

export default SettingsTab;
