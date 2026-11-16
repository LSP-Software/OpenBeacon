import { InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dismissAnnouncement, pickAnnouncement, useAnnouncements } from "../lib/announcements.ts";
import { cn } from "../lib/cn.ts";
import { formatDowntime } from "../lib/formatDowntime.ts";
import { useCurrentInAppNotice } from "../lib/inAppNotices.ts";
import { useOfflineStatus } from "../lib/networkStatus.ts";
import { appVersion } from "../lib/versions.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const AnnouncementBanner = () => {
  const { announcements, dismissed } = useAnnouncements();
  const notice = useCurrentInAppNotice();
  const offline = useOfflineStatus();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const announcedId = useRef<string | null>(null);
  const announcement = pickAnnouncement({
    announcements,
    dismissed,
    platform: Platform.OS === "ios" ? "ios" : "android",
    appVersion,
    now,
  });
  const visible = announcement !== null && !notice;

  useEffect(() => {
    if (!announcement) return;
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const downtimeEndsAt = announcement.downtimeEndsAt
      ? new Date(announcement.downtimeEndsAt).getTime()
      : Number.POSITIVE_INFINITY;
    const next = Math.min(
      new Date(announcement.endsAt).getTime(),
      midnight.getTime(),
      now.getTime() + 60 * 60_000,
      downtimeEndsAt > now.getTime() ? downtimeEndsAt : Number.POSITIVE_INFINITY,
    );
    const timer = setTimeout(() => setNow(new Date()), Math.max(next - Date.now(), 0) + 1_000);
    return () => clearTimeout(timer);
  }, [announcement, now]);

  useEffect(() => {
    if (!visible || announcedId.current === announcement.id) return;
    announcedId.current = announcement.id;
    AccessibilityInfo.announceForAccessibility(announcement.message);
  }, [visible, announcement]);

  if (!visible) return null;
  const warning = announcement.severity === "warning";
  const expanded = expandedId === announcement.id;
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="absolute left-4 right-4"
      style={{ top: insets.top + (offline ? 36 : 8) }}
    >
      <View
        className={cn(
          "flex-row items-start gap-3 rounded-2xl border p-4 shadow-lg",
          warning ? "border-warning-border bg-warning" : "border-border bg-card",
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
    </View>
  );
};
