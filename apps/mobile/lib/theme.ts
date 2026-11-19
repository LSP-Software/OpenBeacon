import { useTheme } from "../providers/ThemeProvider.tsx";
import type { ResolvedTheme } from "./themePreferences.ts";

export type Colors = {
  isDark: boolean;
  background: string;
  surface: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
};

const BRAND = "#FF1464";

const getColors = (theme: ResolvedTheme): Colors => {
  const dark = theme === "dark";

  if (dark) {
    return {
      isDark: true,
      background: "#0B0912",
      surface: "#130F1E",
      text: "#EDE8F5",
      textSecondary: "#B9B0CC",
      textMuted: "#9A90B0",
      primary: BRAND,
    };
  }

  return {
    isDark: false,
    background: "#F4F0FA",
    surface: "#FFFFFF",
    text: "#1A1025",
    textSecondary: "#564B6B",
    textMuted: "#6C5F81",
    primary: BRAND,
  };
};

export const useColors = (): Colors => {
  const { appTheme } = useTheme();

  return getColors(appTheme);
};
