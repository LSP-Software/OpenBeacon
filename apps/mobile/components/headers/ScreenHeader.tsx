import type { Href } from "expo-router";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text } from "../ui/Text.tsx";
import { BackButton } from "./BackButton.tsx";

export const ScreenHeader = ({
  title,
  subtitle,
  hideBack = false,
  fallback,
}: {
  title: string;
  subtitle?: string | undefined;
  hideBack?: boolean;
  fallback?: Href;
}) => (
  <SafeAreaView edges={["top"]} className="bg-background">
    <View className="min-h-14 flex-row items-center gap-1 px-2 py-1">
      {hideBack ? (
        <View className="w-2" />
      ) : fallback ? (
        <BackButton fallback={fallback} />
      ) : (
        <BackButton />
      )}
      <View className="min-w-0 flex-1">
        <Text
          accessibilityRole="header"
          className="text-foreground text-xl font-semibold"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-tertiary text-sm" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  </SafeAreaView>
);
