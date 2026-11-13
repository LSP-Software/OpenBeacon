import { describe, expect, mock, test } from "bun:test";
const BatteryIcon = () => null;
const BatteryChargingIcon = () => null;
const BatteryFullIcon = () => null;
const BatteryLowIcon = () => null;
const BatteryMediumIcon = () => null;
mock.module("lucide-react-native", () => ({
  BatteryIcon,
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
  test("labels a known level as a percentage", () => {
    expect(getBatteryVisual({ batteryLevel: 72, charging: false }).label).toBe("72%");
    expect(getBatteryVisual({ batteryLevel: 0, charging: true }).label).toBe("0%");
  });
  test("hides the percentage when the level is unknown", () => {
    const unknown = getBatteryVisual({ batteryLevel: null, charging: false });
    expect(unknown.icon as unknown).toBe(BatteryIcon);
    expect(unknown.colorClass).toBe("text-foreground");
    expect(unknown.label).toBeNull();

    const charging = getBatteryVisual({ batteryLevel: null, charging: true });
    expect(charging.icon as unknown).toBe(BatteryChargingIcon);
    expect(charging.label).toBeNull();
  });
});
