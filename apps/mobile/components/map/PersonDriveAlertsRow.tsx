import { CarIcon } from "lucide-react-native";
import { View } from "react-native";
import { useCachedGroup } from "../../hooks/useCachedGroup.ts";
import { useDriveAlertMutes } from "../../hooks/useDriveAlertMutes.ts";
import { Icon } from "../ui/Icon.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";

export const PersonDriveAlertsRow = ({
  groupId,
  name,
  userId,
}: {
  groupId: string;
  name: string;
  userId: string;
}) => {
  const { group } = useCachedGroup(groupId);
  const { mutes, setMute } = useDriveAlertMutes(groupId);
  if (!mutes.data) return null;
  const everyoneMuted = mutes.data.mutes.some((mute) => mute.mutedUserId === null);
  const on = !everyoneMuted && !mutes.data.mutes.some((mute) => mute.mutedUserId === userId);
  return (
    <View className="mt-4 flex-row items-center gap-3">
      <View className="size-10 items-center justify-center rounded-full bg-secondary">
        <Icon as={CarIcon} size={20} className="text-primary" />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-semibold">{name}’s Drive alerts</Text>
        <Text className="text-secondary text-sm">
          {everyoneMuted
            ? `You muted everyone in ${group?.name ?? "this group"}.`
            : `In ${group?.name ?? "this group"}. Only changes your alerts.`}
        </Text>
      </View>
      <Switch
        accessibilityLabel={`${name}’s Drive alerts`}
        disabled={everyoneMuted}
        value={on}
        onValueChange={(next) => setMute({ mutedUserId: userId, muted: !next })}
      />
    </View>
  );
};
