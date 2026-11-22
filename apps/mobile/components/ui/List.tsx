import { type Href, Link } from "expo-router";
import {
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  type LucideIcon,
} from "lucide-react-native";
import { Children, createContext, isValidElement, useContext } from "react";
import { Platform, Pressable, View } from "react-native";
import { cn } from "../../lib/cn.ts";
import { Icon } from "./Icon.tsx";
import { Text } from "./Text.tsx";

export const listIconColors = {
  red: "#FF3B30",
  orange: "#FF9500",
  yellow: "#F5B800",
  green: "#34C759",
  teal: "#30B0C7",
  blue: "#007AFF",
  indigo: "#5856D6",
  purple: "#AF52DE",
  pink: "#E6005C",
  gray: "#8E8E93",
} as const;

export type ListIconColor = keyof typeof listIconColors;

const RowPosition = createContext({ first: true, last: true });

const ios = Platform.OS === "ios";

export const ListSection = ({
  title,
  footer,
  children,
  className,
}: {
  title?: string | undefined;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) => {
  const rows = Children.toArray(children).filter(isValidElement);
  if (rows.length === 0) return null;

  return (
    <View className={cn("gap-2", className)}>
      {title ? (
        <Text
          accessibilityRole="header"
          className={
            ios
              ? "px-4 text-[13px] uppercase text-secondary"
              : "px-4 pt-1 text-sm font-semibold text-primary-text"
          }
        >
          {title}
        </Text>
      ) : null}
      <View className={ios ? "overflow-hidden rounded-[26px] bg-card" : "gap-[2px]"}>
        {rows.map((row, index) => (
          <RowPosition.Provider
            key={row.key ?? index}
            value={{ first: index === 0, last: index === rows.length - 1 }}
          >
            {row}
          </RowPosition.Provider>
        ))}
      </View>
      {footer ? (
        typeof footer === "string" ? (
          <Text className="px-4 text-[13px] leading-[18px] text-secondary">{footer}</Text>
        ) : (
          <View className="px-4">{footer}</View>
        )
      ) : null}
    </View>
  );
};

export const ListRow = ({
  title,
  subtitle,
  value,
  icon,
  iconColor = "gray",
  href,
  onPress,
  leading,
  trailing,
  selected,
  tone,
  disabled = false,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  numberOfLines,
}: {
  title: string;
  subtitle?: string | undefined;
  value?: string | undefined;
  icon?: LucideIcon | undefined;
  iconColor?: ListIconColor | undefined;
  href?: Href | undefined;
  onPress?: (() => void) | undefined;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean | undefined;
  tone?: "danger" | "action" | undefined;
  disabled?: boolean | undefined;
  accessibilityRole?: "button" | "link" | "radio" | "switch" | undefined;
  accessibilityLabel?: string | undefined;
  accessibilityHint?: string | undefined;
  accessibilityState?: { checked?: boolean } | undefined;
  numberOfLines?: number | undefined;
}) => {
  const { first, last } = useContext(RowPosition);
  const external = typeof href === "string" && href.startsWith("http");
  const pressable = !!href || !!onPress;
  const secondLine = subtitle ?? (ios ? undefined : value);
  const trailingValue = ios || subtitle ? value : undefined;
  const titleClass = cn(
    ios ? "text-[17px]" : "text-base",
    tone === "danger"
      ? "text-destructive-text"
      : tone === "action"
        ? "text-primary-text"
        : "text-foreground",
    tone && !icon && ios && "text-center",
  );

  const row = (
    <Pressable
      accessibilityRole={accessibilityRole ?? (href ? "link" : pressable ? "button" : undefined)}
      accessibilityLabel={
        accessibilityLabel ?? [title, secondLine, trailingValue].filter(Boolean).join(", ")
      }
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled,
        ...(selected === undefined ? {} : { checked: selected }),
        ...accessibilityState,
      }}
      accessible={pressable}
      disabled={disabled || !pressable}
      onPress={onPress}
      className={cn(
        "flex-row items-center bg-card",
        ios ? "min-h-[50px] gap-3 px-4 py-2.5" : "min-h-14 gap-4 px-4 py-3",
        pressable && "active:bg-container",
        disabled && "opacity-50",
      )}
      style={
        ios
          ? undefined
          : {
              borderTopLeftRadius: first ? 20 : 4,
              borderTopRightRadius: first ? 20 : 4,
              borderBottomLeftRadius: last ? 20 : 4,
              borderBottomRightRadius: last ? 20 : 4,
            }
      }
    >
      {leading}
      {icon ? (
        ios ? (
          <View
            className="size-[30px] items-center justify-center rounded-[8px]"
            style={{
              backgroundColor: tone === "danger" ? listIconColors.red : listIconColors[iconColor],
            }}
          >
            <Icon as={icon} size={18} color="#FFFFFF" />
          </View>
        ) : (
          <View className="size-10 items-center justify-center rounded-full bg-container">
            <Icon
              as={icon}
              size={22}
              className={tone === "danger" ? "text-destructive-text" : "text-secondary"}
            />
          </View>
        )
      ) : null}
      <View className={cn("min-w-0 flex-1", !ios && "gap-0.5")}>
        <Text className={titleClass} numberOfLines={numberOfLines}>
          {title}
        </Text>
        {secondLine ? (
          <Text className={ios ? "text-[13px] text-secondary" : "text-sm text-secondary"}>
            {secondLine}
          </Text>
        ) : null}
      </View>
      {trailingValue ? (
        <Text
          className={cn("max-w-[45%] text-secondary", ios ? "text-[17px]" : "text-sm")}
          numberOfLines={1}
        >
          {trailingValue}
        </Text>
      ) : null}
      {pressable && accessibilityRole === "switch" ? (
        <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {trailing}
        </View>
      ) : (
        trailing
      )}
      {selected && ios ? (
        <Icon as={CheckIcon} size={20} strokeWidth={2.5} className="text-primary-text" />
      ) : null}
      {href && ios ? (
        <Icon
          as={external ? ExternalLinkIcon : ChevronRightIcon}
          size={external ? 16 : 20}
          className="text-border-strong"
        />
      ) : null}
      {href && !ios && external ? (
        <Icon as={ExternalLinkIcon} size={18} className="text-secondary" />
      ) : null}
      {ios && !first ? (
        <View
          pointerEvents="none"
          className={cn(
            "absolute right-0 top-0 h-hairline bg-border",
            icon ? "left-[58px]" : "left-4",
          )}
        />
      ) : null}
    </Pressable>
  );

  return href ? (
    <Link href={href} asChild>
      {row}
    </Link>
  ) : (
    row
  );
};
