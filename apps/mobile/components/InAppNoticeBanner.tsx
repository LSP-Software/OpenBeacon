import { Link } from "expo-router";
import { XIcon } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { dismissInAppNotice, useCurrentInAppNotice } from "../lib/inAppNotices.ts";
import { Icon } from "./ui/Icon.tsx";
import { Text } from "./ui/Text.tsx";

export const InAppNoticeBanner = () => {
  const notice = useCurrentInAppNotice();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => dismissInAppNotice(notice.id), 6_000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <View
      accessibilityRole="alert"
      className="absolute left-4 right-4"
      style={{ top: insets.top + 8 }}
    >
      <View className="flex-row items-center gap-2 rounded-2xl border border-border bg-card p-4 shadow-lg">
        <Link href={notice.href} asChild>
          <Pressable
            accessibilityRole="link"
            className="flex-1 gap-0.5"
            onPress={() => dismissInAppNotice(notice.id)}
          >
            <Text className="font-semibold text-foreground">{notice.title}</Text>
            {notice.body ? <Text className="text-tertiary">{notice.body}</Text> : null}
          </Pressable>
        </Link>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          hitSlop={12}
          onPress={() => dismissInAppNotice(notice.id)}
        >
          <Icon as={XIcon} size={18} className="text-tertiary" />
        </Pressable>
      </View>
    </View>
  );
};
