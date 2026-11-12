import type { deviceIconSchema } from "@openbeacon/schemas";
import {
  createLucideIcon,
  Flower2Icon,
  HeartIcon,
  type LucideIcon,
  SmartphoneIcon,
  StarIcon,
  SunIcon,
  TabletIcon,
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

const ClassicPhoneIcon = createLucideIcon("ClassicPhone", [
  ["rect", { width: "12", height: "20", x: "6", y: "2", rx: "2", key: "body" }],
  ["path", { d: "M6 6h12M6 17h12", key: "screen" }],
  ["path", { d: "M12 19.5h.01", key: "button" }],
]);

export const deviceIcons = {
  phone: { icon: SmartphoneIcon, label: "Phone" },
  phoneClassic: { icon: ClassicPhoneIcon, label: "Classic phone" },
  tablet: { icon: WideTabletIcon, label: "Landscape tablet" },
  tabletPortrait: { icon: TabletIcon, label: "Portrait tablet" },
  star: { icon: StarIcon, label: "Star" },
  heart: { icon: HeartIcon, label: "Heart" },
  flower: { icon: Flower2Icon, label: "Flower" },
  sun: { icon: SunIcon, label: "Sun" },
} satisfies Partial<Record<DeviceIcon, { icon: LucideIcon; label: string }>>;

export const selectableDeviceIcons = Object.keys(deviceIcons) as (keyof typeof deviceIcons)[];

export const deviceIconFor = (
  icon: DeviceIcon,
  platform: string | null | undefined,
): { icon: LucideIcon; label: string } => {
  if (icon === "phone" && platform === "ios") return { icon: IPhoneIcon, label: "iPhone" };
  if (icon === "phone" && platform === "android") {
    return { icon: AndroidPhoneIcon, label: "Android phone" };
  }
  if (icon in deviceIcons) return deviceIcons[icon as keyof typeof deviceIcons];
  return deviceIconFor("phone", platform);
};
