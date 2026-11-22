import type { ResolvedTheme } from "./themePreferences.ts";

export type PalettePlatform = "ios" | "android";

export type Palette = {
  background: string;
  card: string;
  foreground: string;
  "text-secondary": string;
  "text-tertiary": string;
  border: string;
  "border-strong": string;
  secondary: string;
  "secondary-foreground": string;
  container: string;
  "primary-text": string;
  "on-primary-text": string;
  "primary-soft": string;
  "primary-soft-foreground": string;
  action: string;
  input: string;
  destructive: string;
  "destructive-text": string;
  "destructive-soft": string;
  success: string;
  "success-soft": string;
  warning: string;
  "warning-border": string;
  "warning-text": string;
  "warning-accent": string;
  "tab-bar": string;
  "tab-indicator": string;
  "map-control": string;
  "map-control-foreground": string;
};

const semanticLight = {
  action: "#E6005C",
  destructive: "#C2290A",
  "destructive-text": "#C2290A",
  "destructive-soft": "#FDECE7",
  success: "#157A4C",
  "success-soft": "#E1F4EA",
  warning: "#FEFCE7",
  "warning-border": "#FCD44F",
  "warning-text": "#8A5A00",
  "warning-accent": "#E7B008",
};

const semanticDark = {
  action: "#E6005C",
  destructive: "#C2290A",
  "destructive-text": "#FF8A70",
  "destructive-soft": "#371710",
  success: "#5FD39B",
  "success-soft": "#142E22",
  warning: "#282315",
  "warning-border": "#8F7424",
  "warning-text": "#F2D98C",
  "warning-accent": "#F6CE55",
};

const palettes: Record<PalettePlatform, Record<ResolvedTheme, Palette>> = {
  ios: {
    light: {
      ...semanticLight,
      background: "#F2F2F7",
      card: "#FFFFFF",
      foreground: "#000000",
      "text-secondary": "#5E5E63",
      "text-tertiary": "#6C6C70",
      border: "#D8D8DC",
      "border-strong": "#C4C4C7",
      secondary: "#E9E9EE",
      "secondary-foreground": "#000000",
      container: "#E9E9EE",
      "primary-text": "#D70057",
      "on-primary-text": "#FFFFFF",
      "primary-soft": "#FFE5EE",
      "primary-soft-foreground": "#B0004A",
      input: "#FFFFFF",
      "tab-bar": "#F9F9F9",
      "tab-indicator": "#E9E9EE",
      "map-control": "#FFFFFF",
      "map-control-foreground": "#1C1C1E",
    },
    dark: {
      ...semanticDark,
      background: "#000000",
      card: "#1C1C1E",
      foreground: "#FFFFFF",
      "text-secondary": "#AEAEB2",
      "text-tertiary": "#9A9AA0",
      border: "#38383A",
      "border-strong": "#545458",
      secondary: "#2C2C2E",
      "secondary-foreground": "#FFFFFF",
      container: "#2C2C2E",
      "primary-text": "#FF2D7A",
      "on-primary-text": "#FFFFFF",
      "primary-soft": "#3A0F20",
      "primary-soft-foreground": "#FFB1C6",
      input: "#1C1C1E",
      "tab-bar": "#121212",
      "tab-indicator": "#2C2C2E",
      "map-control": "#2C2C2E",
      "map-control-foreground": "#F2F2F7",
    },
  },
  android: {
    light: {
      ...semanticLight,
      background: "#FFF8F8",
      card: "#FFFFFF",
      foreground: "#22191B",
      "text-secondary": "#534347",
      "text-tertiary": "#65555A",
      border: "#EBDDE0",
      "border-strong": "#857377",
      secondary: "#F6DCE2",
      "secondary-foreground": "#2B151B",
      container: "#F8EAED",
      "primary-text": "#B5174F",
      "on-primary-text": "#FFFFFF",
      "primary-soft": "#FFD9E2",
      "primary-soft-foreground": "#3F0019",
      input: "#FFF8F8",
      "tab-bar": "#F8EAED",
      "tab-indicator": "#F6DCE2",
      "map-control": "#FFD9E2",
      "map-control-foreground": "#3F0019",
    },
    dark: {
      ...semanticDark,
      background: "#191113",
      card: "#2B2023",
      foreground: "#EFDFE1",
      "text-secondary": "#D7C1C5",
      "text-tertiary": "#BBA7AB",
      border: "#3C3235",
      "border-strong": "#A08C90",
      secondary: "#5C3F47",
      "secondary-foreground": "#FFD9E2",
      container: "#261D1F",
      "primary-text": "#FFB1C6",
      "on-primary-text": "#650030",
      "primary-soft": "#8E0F45",
      "primary-soft-foreground": "#FFD9E2",
      input: "#191113",
      "tab-bar": "#261D1F",
      "tab-indicator": "#5C3F47",
      "map-control": "#31282A",
      "map-control-foreground": "#EFDFE1",
    },
  },
};

export const getPalette = (platform: PalettePlatform, theme: ResolvedTheme): Palette =>
  palettes[platform][theme];

export const hexToRgbChannels = (hex: string) => {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
};

export const paletteCssVariables = (palette: Palette) =>
  Object.fromEntries(
    Object.entries(palette).map(([name, hex]) => [`--${name}`, hexToRgbChannels(hex)]),
  );
