import { Platform } from "react-native";
import { useAppTheme } from "../providers/ThemeProvider.tsx";
import { getPalette, type Palette } from "./palette.ts";

export type Colors = {
  isDark: boolean;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  tint: string;
  palette: Palette;
};

export const useColors = (): Colors => {
  const appTheme = useAppTheme();
  const palette = getPalette(Platform.OS === "ios" ? "ios" : "android", appTheme);

  return {
    isDark: appTheme === "dark",
    background: palette.background,
    surface: palette.card,
    text: palette.foreground,
    textSecondary: palette["text-secondary"],
    textMuted: palette["text-tertiary"],
    primary: palette.action,
    tint: palette["primary-text"],
    palette,
  };
};
