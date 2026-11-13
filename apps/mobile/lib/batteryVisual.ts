import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
} from "lucide-react-native";

export const getBatteryVisual = ({
  batteryLevel,
  charging,
}: {
  batteryLevel: number | null;
  charging: boolean;
}) => {
  if (batteryLevel === null) {
    return {
      icon: charging ? BatteryChargingIcon : BatteryIcon,
      colorClass: "text-foreground",
      label: null,
    };
  }

  const label = `${batteryLevel}%`;

  if (charging) {
    return {
      icon: BatteryChargingIcon,
      colorClass: batteryLevel < 20 ? "text-red-700" : "text-foreground",
      label,
    };
  }

  if (batteryLevel < 20) {
    return { icon: BatteryLowIcon, colorClass: "text-red-700", label };
  }

  if (batteryLevel <= 60) {
    return { icon: BatteryMediumIcon, colorClass: "text-foreground", label };
  }

  return { icon: BatteryFullIcon, colorClass: "text-foreground", label };
};
