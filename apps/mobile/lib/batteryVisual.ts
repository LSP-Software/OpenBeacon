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
    return { icon: BatteryChargingIcon, colorClass: "text-green-500" };
  }

  if (batteryLevel <= 25) {
    return { icon: BatteryLowIcon, colorClass: "text-red-500" };
  }

  if (batteryLevel <= 60) {
    return { icon: BatteryMediumIcon, colorClass: "text-orange-500" };
  }

  return { icon: BatteryFullIcon, colorClass: "text-green-500" };
};
