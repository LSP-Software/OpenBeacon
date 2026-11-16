import { InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import {
  dismissAnnouncement,
  nextAnnouncementCheck,
  pickAnnouncement,
  useAnnouncements,
} from "../lib/announcements.ts";
import { cn } from "../lib/cn.ts";
import { baseUrl, hasCustomServerUrl } from "../lib/currentServer.ts";
import { formatDowntime } from "../lib/formatDowntime.ts";
import { appVersion } from "../lib/versions.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

const spokenIds = new Set<string>();

export const AnnouncementBanner = ({ className }: { className?: string }) => {
  const { announcements, dismissed } = useAnnouncements();
  const [now, setNow] = useState(() => new Date());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const announcement = pickAnnouncement({
    announcements,
    dismissed,
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion,
    now,
  });

  useEffect(() => {
    const next = nextAnnouncementCheck(announcements, now);
    const timer = setTimeout(
      () => setNow(new Date()),
      Math.max(next.getTime() - Date.now(), 0) + 1_000,
    );
    return () => clearTimeout(timer);
  }, [announcements, now]);

  useEffect(() => {
    if (!announcement || spokenIds.has(announcement.id)) return;
    spokenIds.add(announcement.id);
    AccessibilityInfo.announceForAccessibility(announcement.message);
  }, [announcement]);

  if (!announcement) return null;
  const warning = announcement.severity === "warning";
  const expanded = expandedId === announcement.id;
  const server = hasCustomServerUrl()
    ? baseUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    : null;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className={cn(
        "flex-row items-start gap-3 rounded-xl border p-4",
        warning ? "border-warning-border bg-warning" : "border-border bg-card",
        className,
      )}
    >
      <Icon
        as={warning ? TriangleAlertIcon : InfoIcon}
        size={20}
        className={warning ? "text-warning-accent" : "text-primary"}
      />
      <View className="flex-1 gap-1">
        <Pressable
          accessibilityState={{ expanded }}
          onPress={() => setExpandedId(expanded ? null : announcement.id)}
        >
          <Text className="text-foreground" numberOfLines={expanded ? undefined : 4}>
            {announcement.message}
          </Text>
        </Pressable>
        {announcement.downtimeStartsAt &&
        announcement.downtimeEndsAt &&
        new Date(announcement.downtimeEndsAt) > now ? (
          <Text className="font-semibold text-foreground">
            {formatDowntime(
              new Date(announcement.downtimeStartsAt),
              new Date(announcement.downtimeEndsAt),
              now,
            )}
          </Text>
        ) : null}
        {server ? (
          <Text className="text-sm text-muted-foreground">From your server, {server}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss announcement"
        className="-my-3.5 -mr-3.5 h-12 w-12 items-center justify-center"
        hitSlop={4}
        onPress={() => dismissAnnouncement(announcement)}
      >
        <Icon as={XIcon} size={18} className="text-muted-foreground" />
      </Pressable>
    </View>
  );
};
