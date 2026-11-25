import type { DrivingEventType } from "@openbeacon/encryption";
import { ChevronsDownIcon, ChevronsUpIcon, GaugeIcon, SmartphoneIcon } from "lucide-react-native";
import { View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Icon } from "../ui/Icon.tsx";
import { Text } from "../ui/Text.tsx";

export const DRIVING_EVENT_LOOK: Record<
  DrivingEventType,
  { color: string; icon: typeof GaugeIcon; label: string }
> = {
  SPEEDING: { color: "#C62828", icon: GaugeIcon, label: "Possible speeding" },
  RAPID_ACCELERATION: {
    color: "#E65100",
    icon: ChevronsUpIcon,
    label: "Possible rapid acceleration",
  },
  HARD_BRAKING: {
    color: "#6A1B9A",
    icon: ChevronsDownIcon,
    label: "Possible hard braking",
  },
  PHONE_USE: {
    color: "#1565C0",
    icon: SmartphoneIcon,
    label: "Possible phone use",
  },
};

export const DrivingEventIcon = ({
  size = 32,
  type,
}: {
  size?: number;
  type: DrivingEventType;
}) => {
  const look = DRIVING_EVENT_LOOK[type];
  return (
    <View
      className="items-center justify-center rounded-full border-2 border-white"
      style={{ backgroundColor: look.color, height: size, width: size }}
    >
      <Icon as={look.icon} size={Math.round(size * 0.55)} className="text-white" />
    </View>
  );
};

export const scoreColor = (score: number) =>
  score >= 85 ? "#1E6B3A" : score >= 70 ? "#B26A00" : "#C2410C";

export const DriveScoreBadge = ({
  large = false,
  score,
}: {
  large?: boolean;
  score: number | null;
}) => {
  const size = large ? 88 : 48;
  if (score === null) {
    return (
      <View
        accessible
        accessibilityLabel="No Driving score"
        className="items-center justify-center rounded-full border-2 border-dashed border-border-strong"
        style={{ height: size, width: size }}
      >
        <Text className="text-secondary">–</Text>
      </View>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={`Driving score ${score}`}
      className="items-center justify-center rounded-full bg-card"
      style={{
        borderColor: scoreColor(score),
        borderWidth: large ? 5 : 3,
        height: size,
        width: size,
      }}
    >
      <Text
        className={cn("font-bold", large ? "text-3xl" : "text-lg")}
        style={{ color: scoreColor(score) }}
      >
        {score}
      </Text>
    </View>
  );
};
