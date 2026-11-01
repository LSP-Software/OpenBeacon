import { describe, expect, mock, test } from "bun:test";
const BatteryChargingIcon = () => null;
const BatteryFullIcon = () => null;
const BatteryLowIcon = () => null;
const BatteryMediumIcon = () => null;
mock.module("lucide-react-native", () => ({
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
}));
const { getBatteryVisual } = await import("./batteryVisual.ts");

describe("battery visual", () => {
  test("shows red only below twenty percent", () => {
    expect(getBatteryVisual({ batteryLevel: 0, charging: false }).colorClass).toBe("text-red-700");
    expect(getBatteryVisual({ batteryLevel: 19, charging: false }).colorClass).toBe("text-red-700");
    expect(getBatteryVisual({ batteryLevel: 20, charging: false }).colorClass).toBe(
      "text-foreground",
    );
    expect(getBatteryVisual({ batteryLevel: 60, charging: false }).colorClass).toBe(
      "text-foreground",
    );
    expect(getBatteryVisual({ batteryLevel: 61, charging: false }).colorClass).toBe(
      "text-foreground",
    );
  });
  test("shows low charging batteries in red", () => {
    expect(getBatteryVisual({ batteryLevel: 19, charging: true }).colorClass).toBe("text-red-700");
    expect(getBatteryVisual({ batteryLevel: 20, charging: true }).colorClass).toBe(
      "text-foreground",
    );
  });
});
