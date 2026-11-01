import {
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
} from "lucide-react-native";

export const getBatteryVisual = ({
  batteryLevel,
  charging,
}: {
  batteryLevel: number;
  charging: boolean;
}) => {
  if (charging) {
    return {
      icon: BatteryChargingIcon,
      colorClass: batteryLevel < 20 ? "text-red-700" : "text-foreground",
    };
  }

  if (batteryLevel < 20) {
    return { icon: BatteryLowIcon, colorClass: "text-red-700" };
  }

  if (batteryLevel <= 60) {
    return { icon: BatteryMediumIcon, colorClass: "text-foreground" };
  }

  return { icon: BatteryFullIcon, colorClass: "text-foreground" };
};
