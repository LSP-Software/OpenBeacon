import { InfoIcon, TriangleAlertIcon, XIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  dismissAnnouncement,
  formatDowntime,
  pickAnnouncement,
  useAnnouncements,
} from "../lib/announcements.ts";
import { cn } from "../lib/cn.ts";
import { useCurrentInAppNotice } from "../lib/inAppNotices.ts";
import { useOfflineStatus } from "../lib/networkStatus.ts";
import { appVersion } from "../lib/versions.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const AnnouncementBanner = () => {
  const { announcements, dismissedIds } = useAnnouncements();
  const notice = useCurrentInAppNotice();
  const offline = useOfflineStatus();
  const insets = useSafeAreaInsets();
  const [now, setNow] = useState(() => new Date());
  const announcement = pickAnnouncement({
    announcements,
    dismissedIds,
    platform: Platform.OS,
    appVersion,
    now,
  });

  useEffect(() => {
    setNow(new Date());
    if (!announcement) return;
    const timer = setTimeout(
      () => setNow(new Date()),
      Math.min(new Date(announcement.endsAt).getTime() - Date.now() + 1_000, 60 * 60_000),
    );
    return () => clearTimeout(timer);
  }, [announcement]);

  if (!announcement || notice) return null;
  const warning = announcement.severity === "warning";
  return (
    <View
      accessibilityRole="alert"
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
          <Text className="text-foreground">{announcement.message}</Text>
          {announcement.downtimeStartsAt && announcement.downtimeEndsAt ? (
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
          hitSlop={12}
          onPress={() => dismissAnnouncement(announcement.id)}
        >
          <Icon as={XIcon} size={18} className="text-muted-foreground" />
        </Pressable>
      </View>
    </View>
  );
};
