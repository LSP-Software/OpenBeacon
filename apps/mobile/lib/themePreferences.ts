import type { ColorSchemeName } from "react-native";
import { storage } from "./storage.ts";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const APP_THEME_PREFERENCE_KEY = "theme.preference.app";
const MAP_THEME_PREFERENCE_KEY = "theme.preference.map";

const isThemePreference = (value: string | undefined): value is ThemePreference => {
  return value === "system" || value === "light" || value === "dark";
};

const getStoredThemePreference = (key: string): ThemePreference => {
  const storedThemePreference = storage.getString(key);

  if (!isThemePreference(storedThemePreference)) {
    return "system";
  }

  return storedThemePreference;
};

export const getStoredAppThemePreference = (): ThemePreference => {
  return getStoredThemePreference(APP_THEME_PREFERENCE_KEY);
};

export const setStoredAppThemePreference = (themePreference: ThemePreference) => {
  storage.set(APP_THEME_PREFERENCE_KEY, themePreference);
};

export const getStoredMapThemePreference = (): ThemePreference => {
  return getStoredThemePreference(MAP_THEME_PREFERENCE_KEY);
};

export const setStoredMapThemePreference = (themePreference: ThemePreference) => {
  storage.set(MAP_THEME_PREFERENCE_KEY, themePreference);
};

export const resolveThemePreference = (
  themePreference: ThemePreference,
  systemColorScheme: ColorSchemeName | null | undefined,
): ResolvedTheme => {
  if (themePreference === "light" || themePreference === "dark") {
    return themePreference;
  }

  return systemColorScheme === "dark" ? "dark" : "light";
};
