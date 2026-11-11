import type { deviceIconSchema } from "@openbeacon/schemas";
import {
  BackpackIcon,
  CarIcon,
  HouseIcon,
  LaptopIcon,
  type LucideIcon,
  SmartphoneIcon,
  TabletIcon,
  TagIcon,
  WatchIcon,
} from "lucide-react-native";
import type { z } from "zod";

export type DeviceIcon = z.infer<typeof deviceIconSchema>;

export const deviceIcons = {
  phone: { icon: SmartphoneIcon, label: "Phone" },
  tablet: { icon: TabletIcon, label: "Tablet" },
  watch: { icon: WatchIcon, label: "Watch" },
  car: { icon: CarIcon, label: "Car" },
  laptop: { icon: LaptopIcon, label: "Laptop" },
  bag: { icon: BackpackIcon, label: "Bag" },
  tag: { icon: TagIcon, label: "Tag" },
  home: { icon: HouseIcon, label: "Home" },
} satisfies Record<DeviceIcon, { icon: LucideIcon; label: string }>;
