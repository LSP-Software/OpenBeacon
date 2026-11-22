import type { LucideIcon } from "lucide-react-native";
import { Children, isValidElement } from "react";
import { Platform, Pressable, View } from "react-native";
import { Icon } from "../ui/Icon.tsx";
import { MapSurface } from "./MapSurface.tsx";

const ios = Platform.OS === "ios";

export const MapChip = ({
  active,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Pressable>, "children" | "className"> & {
  active: boolean;
  children: React.ReactNode;
}) => {
  const content = (
    <Pressable
      accessibilityRole="button"
      hitSlop={{ top: 4, bottom: 4 }}
      className="h-10 flex-row items-center gap-1.5 px-3.5 active:opacity-70"
      {...props}
    >
      {children}
    </Pressable>
  );

  return active ? (
    <View className="rounded-full bg-foreground">{content}</View>
  ) : (
    <MapSurface radius={ios ? 20 : 12}>{content}</MapSurface>
  );
};

export const MapIconButton = ({
  icon,
  active = false,
  ...props
}: Omit<React.ComponentProps<typeof Pressable>, "children" | "className"> & {
  icon: LucideIcon;
  active?: boolean;
}) => (
  <Pressable
    accessibilityRole="button"
    className="size-12 items-center justify-center active:opacity-60"
    {...props}
  >
    <Icon
      as={icon}
      size={21}
      className={
        active ? "text-primary-text" : ios ? "text-foreground" : "text-primary-soft-foreground"
      }
    />
  </Pressable>
);

export const MapButtonGroup = ({ children }: { children: React.ReactNode[] }) => {
  const buttons = Children.toArray(children).filter(isValidElement);
  if (buttons.length === 0) return null;
  return ios ? (
    <MapSurface radius={24}>
      <View className="py-1">{buttons}</View>
    </MapSurface>
  ) : (
    <View className="gap-3">
      {buttons.map((button) => (
        <MapSurface key={button.key} radius={16}>
          {button}
        </MapSurface>
      ))}
    </View>
  );
};
