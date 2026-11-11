import type { deviceIconSchema } from "@openbeacon/schemas";
import {
  BackpackIcon,
  CarIcon,
  createLucideIcon,
  HouseIcon,
  LaptopIcon,
  type LucideIcon,
  SmartphoneIcon,
  TagIcon,
  WatchIcon,
} from "lucide-react-native";
import type { z } from "zod";

export type DeviceIcon = z.infer<typeof deviceIconSchema>;

const IPhoneIcon = createLucideIcon("IPhone", [
  ["rect", { width: "14", height: "20", x: "5", y: "2", rx: "3", ry: "3", key: "body" }],
  ["path", { d: "M10 5.5h4", key: "island" }],
]);

const AndroidPhoneIcon = createLucideIcon("AndroidPhone", [
  ["rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2", key: "body" }],
  ["circle", { cx: "12", cy: "5.5", r: "0.75", key: "camera" }],
]);

const WideTabletIcon = createLucideIcon("WideTablet", [
  ["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2", ry: "2", key: "body" }],
  ["path", { d: "M12 7h.01", key: "camera" }],
]);

export const deviceIcons = {
  phone: { icon: SmartphoneIcon, label: "Phone" },
  tablet: { icon: WideTabletIcon, label: "Tablet" },
  watch: { icon: WatchIcon, label: "Watch" },
  car: { icon: CarIcon, label: "Car" },
  laptop: { icon: LaptopIcon, label: "Laptop" },
  bag: { icon: BackpackIcon, label: "Bag" },
  tag: { icon: TagIcon, label: "Tag" },
  home: { icon: HouseIcon, label: "Home" },
} satisfies Record<DeviceIcon, { icon: LucideIcon; label: string }>;

export const deviceIconFor = (
  icon: DeviceIcon,
  platform: string | null | undefined,
): { icon: LucideIcon; label: string } => {
  if (icon === "phone" && platform === "ios") return { icon: IPhoneIcon, label: "iPhone" };
  if (icon === "phone" && platform === "android") {
    return { icon: AndroidPhoneIcon, label: "Android phone" };
  }
  return deviceIcons[icon];
};
