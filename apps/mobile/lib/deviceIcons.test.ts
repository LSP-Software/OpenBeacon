import { describe, expect, mock, test } from "bun:test";

const lucideIcon = (name: string) => Object.assign(() => null, { displayName: name });
mock.module("lucide-react-native", () => ({
  createLucideIcon: lucideIcon,
  Flower2Icon: lucideIcon("Flower"),
  HeartIcon: lucideIcon("Heart"),
  SmartphoneIcon: lucideIcon("Smartphone"),
  StarIcon: lucideIcon("Star"),
  SunIcon: lucideIcon("Sun"),
  TabletIcon: lucideIcon("Tablet"),
}));
const { deviceIconFor, deviceIcons, selectableDeviceIcons } = await import("./deviceIcons.ts");

describe("deviceIconFor", () => {
  test("draws phones by platform and falls back to a generic phone", () => {
    const iPhone = deviceIconFor("phone", "ios");
    const android = deviceIconFor("phone", "android");

    expect(iPhone.label).toBe("iPhone");
    expect(android.label).toBe("Android phone");
    expect(iPhone.icon).not.toBe(android.icon);
    expect(deviceIconFor("phone", null)).toBe(deviceIcons.phone);
    expect(deviceIconFor("phone", "windows")).toBe(deviceIcons.phone);
  });

  test("keeps selectable identifiers distinct and independent of platform", () => {
    expect(selectableDeviceIcons).toEqual([
      "phone",
      "phoneClassic",
      "tablet",
      "tabletPortrait",
      "star",
      "heart",
      "flower",
      "sun",
    ]);
    for (const icon of selectableDeviceIcons) {
      if (icon === "phone") continue;
      expect(deviceIconFor(icon, "ios")).toBe(deviceIcons[icon]);
      expect(deviceIconFor(icon, "android")).toBe(deviceIcons[icon]);
    }
    expect(new Set(Object.values(deviceIcons).map(({ icon }) => icon)).size).toBe(8);
  });

  test("shows a phone for retired icons without offering them in the picker", () => {
    for (const icon of ["watch", "car", "laptop", "bag", "tag", "home"] as const) {
      for (const platform of ["ios", "android", null]) {
        expect(deviceIconFor(icon, platform)).toEqual(deviceIconFor("phone", platform));
      }
    }
  });
});
