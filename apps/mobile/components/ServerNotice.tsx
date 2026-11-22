import { useIsFocused } from "@react-navigation/native";
import { Link } from "expo-router";
import { Pressable, View } from "react-native";
import { getBaseUrl, hasCustomServerUrl } from "../lib/currentServer.ts";
import { Text } from "./ui/Text.tsx";

export const ServerNotice = () => {
  useIsFocused();
  if (!hasCustomServerUrl()) return null;
  const base = getBaseUrl();
  const host = URL.canParse(base) ? new URL(base).host : base;
  return (
    <View className="flex-row items-center gap-3 rounded-3xl bg-card px-4 py-3">
      <Text accessible accessibilityLabel={`Server: ${host}`} className="flex-1 text-secondary">
        Server: <Text className="font-semibold text-foreground">{host}</Text>
      </Text>
      <Link href="/serverUrl" asChild>
        <Pressable className="py-1" accessibilityRole="link" accessibilityLabel="Change server">
          <Text className="font-semibold text-primary-text">Change</Text>
        </Pressable>
      </Link>
    </View>
  );
};
