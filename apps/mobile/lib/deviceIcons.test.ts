import { describe, expect, mock, test } from "bun:test";

const lucideIcon = (name: string) => Object.assign(() => null, { displayName: name });
mock.module("lucide-react-native", () => ({
  BackpackIcon: lucideIcon("Backpack"),
  CarIcon: lucideIcon("Car"),
  createLucideIcon: lucideIcon,
  HouseIcon: lucideIcon("House"),
  LaptopIcon: lucideIcon("Laptop"),
  SmartphoneIcon: lucideIcon("Smartphone"),
  TagIcon: lucideIcon("Tag"),
  WatchIcon: lucideIcon("Watch"),
}));
const { deviceIconFor, deviceIcons } = await import("./deviceIcons.ts");

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

  test("keeps every other icon whatever the platform", () => {
    expect(deviceIconFor("tablet", "ios")).toBe(deviceIcons.tablet);
    expect(deviceIconFor("watch", "android")).toBe(deviceIcons.watch);
    expect(deviceIcons.tablet.icon).not.toBe(deviceIcons.phone.icon);
  });
});
