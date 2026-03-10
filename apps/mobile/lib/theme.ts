import { useColorScheme } from "react-native";

export type Colors = {
  isDark: boolean;
  background: string;
  surface: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primaryDim: string;
  inputBackground: string;
  inputBorder: string;
  inputBorderFocused: string;
};

const BRAND = "#FF1464";

export function useColors(): Colors {
  const scheme = useColorScheme();
  const dark = scheme === "dark";

  if (dark) {
    return {
      isDark: true,
      background: "#0B0912",
      surface: "#130F1E",
      border: "#281F3D",
      text: "#EDE8F5",
      textSecondary: "#7A6E90",
      textMuted: "#4A4060",
      primary: BRAND,
      onPrimary: "#FFFFFF",
      primaryDim: "#FF146420",
      inputBackground: "#0F0C1A",
      inputBorder: "#281F3D",
      inputBorderFocused: BRAND,
    };
  }

  return {
    isDark: false,
    background: "#F4F0FA",
    surface: "#FFFFFF",
    border: "#E2D9F3",
    text: "#1A1025",
    textSecondary: "#6B5F80",
    textMuted: "#A89CC0",
    primary: BRAND,
    onPrimary: "#FFFFFF",
    primaryDim: "#FF146415",
    inputBackground: "#FFFFFF",
    inputBorder: "#D8CEF0",
    inputBorderFocused: BRAND,
  };
}
