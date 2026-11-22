import { Stack } from "expo-router";
import { Platform, View } from "react-native";
import { Text } from "../ui/Text.tsx";

export const tabScreenEdges = Platform.OS === "ios" ? ([] as const) : (["top"] as const);

export const TabHeader = ({ title, actions }: { title: string; actions?: React.ReactNode }) =>
  Platform.OS === "ios" ? (
    <Stack.Screen
      options={{
        headerShown: true,
        title,
        headerLargeTitleEnabled: true,
        headerTransparent: true,
        headerStyle: { backgroundColor: "transparent" },
        ...(actions
          ? { headerRight: () => <View className="flex-row gap-2">{actions}</View> }
          : {}),
      }}
    />
  ) : (
    <View className="min-h-16 flex-row items-center justify-between gap-2 pb-2 pl-1 pt-3">
      <Text accessibilityRole="header" className="text-[28px] leading-9 text-foreground">
        {title}
      </Text>
      {actions ? <View className="flex-row gap-2">{actions}</View> : null}
    </View>
  );
