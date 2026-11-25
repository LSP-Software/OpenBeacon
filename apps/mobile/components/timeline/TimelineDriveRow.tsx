import { CarIcon, ChevronRightIcon } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";
import { DriveScoreBadge } from "./DriveBadges.tsx";

export const TimelineDriveRow = ({
  detail,
  onPress,
  passenger,
  score,
  title,
}: {
  detail: string;
  onPress: () => void;
  passenger: boolean;
  score: number | null;
  title: string;
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={`${passenger ? "Passenger drive" : "Drive"}, ${title}, ${detail}${score === null ? "" : `, Driving score ${score}`}. Opens the drive.`}
    onPress={onPress}
    className="flex-row items-center gap-3 rounded-2xl bg-primary-soft px-3 py-2.5"
  >
    <Icon as={CarIcon} size={22} className="text-foreground" />
    <View className="flex-1">
      <Text className="font-semibold text-foreground" numberOfLines={1}>
        {passenger ? "Passenger drive" : "Drive"} · {title}
      </Text>
      <Text className="text-sm text-secondary" numberOfLines={2}>
        {detail}
      </Text>
    </View>
    <DriveScoreBadge score={score} />
    <Icon as={ChevronRightIcon} size={20} className="text-foreground" />
  </Pressable>
);
