import type { Stack } from "expo-router";
import type { ComponentProps } from "react";
import { Platform } from "react-native";
import { useColors } from "../../lib/theme.ts";

export const useHeaderOptions = (): Extract<
  ComponentProps<typeof Stack>["screenOptions"],
  { headerShown?: boolean }
> => {
  const { palette } = useColors();

  return {
    headerShown: false,
    headerShadowVisible: false,
    headerTintColor: Platform.OS === "ios" ? palette.action : palette.foreground,
    headerTitleStyle: { color: palette.foreground },
    headerStyle: { backgroundColor: palette.background },
    headerBackButtonDisplayMode: "minimal",
    headerLargeTitleShadowVisible: false,
    contentStyle: { backgroundColor: palette.background },
  };
};
