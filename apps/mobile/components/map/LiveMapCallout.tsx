import { View } from "react-native";
import { getBatteryVisual } from "../../lib/batteryVisual.ts";
import { timeSince } from "../../lib/timeSince.ts";
import { Card, CardContent } from "../ui/Card.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const LiveMapCallout = ({
  battery,
  name,
  otherSharedGroupNames,
  timestamp,
}: {
  battery: { charging: boolean; level: number };
  name: string;
  otherSharedGroupNames: readonly string[];
  timestamp: string;
}) => {
  const { icon: BatteryIcon, colorClass } = getBatteryVisual({
    batteryLevel: battery.level,
    charging: battery.charging,
  });

  return (
    <Card className="py-4 shadow-md">
      <CardContent className="gap-2">
        <Text className="text-foreground text-xl font-bold">{name}</Text>
        <Text className="text-muted text-sm">Updated {timeSince(timestamp)}</Text>
        <View className="flex-row items-center gap-2">
          <Icon as={BatteryIcon} size={20} className={colorClass} />
          <Text className={`${colorClass} text-sm`}>Battery: {battery.level}%</Text>
        </View>
        {otherSharedGroupNames.length > 0 ? (
          <Text className="text-muted-foreground text-sm">
            Also in {otherSharedGroupNames.join(", ")}
          </Text>
        ) : null}
      </CardContent>
    </Card>
  );
};
