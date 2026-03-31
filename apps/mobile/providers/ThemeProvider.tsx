import { StatusBar } from "expo-status-bar";
import type React from "react";
import { createContext, useContext, useState } from "react";
import { useColorScheme, View } from "react-native";
import {
  getStoredAppThemePreference,
  getStoredMapThemePreference,
  type ResolvedTheme,
  resolveThemePreference,
  setStoredAppThemePreference,
  setStoredMapThemePreference,
  type ThemePreference,
} from "../lib/themePreferences.ts";

type ThemeContextValue = {
  appThemePreference: ThemePreference;
  mapThemePreference: ThemePreference;
  appTheme: ResolvedTheme;
  mapTheme: ResolvedTheme;
  setAppThemePreference: (themePreference: ThemePreference) => void;
  setMapThemePreference: (themePreference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const systemColorScheme = useColorScheme();
  const [appThemePreference, setAppThemePreferenceState] = useState<ThemePreference>(() => {
    return getStoredAppThemePreference();
  });
  const [mapThemePreference, setMapThemePreferenceState] = useState<ThemePreference>(() => {
    return getStoredMapThemePreference();
  });
  const appTheme = resolveThemePreference(appThemePreference, systemColorScheme);
  const mapTheme = resolveThemePreference(mapThemePreference, systemColorScheme);

  const setAppThemePreference = (themePreference: ThemePreference) => {
    setStoredAppThemePreference(themePreference);
    setAppThemePreferenceState(themePreference);
  };

  const setMapThemePreference = (themePreference: ThemePreference) => {
    setStoredMapThemePreference(themePreference);
    setMapThemePreferenceState(themePreference);
  };

  return (
    <ThemeContext.Provider
      value={{
        appThemePreference,
        mapThemePreference,
        appTheme,
        mapTheme,
        setAppThemePreference,
        setMapThemePreference,
      }}
    >
      <StatusBar style={appTheme === "dark" ? "light" : "dark"} />
      <View className={`flex-1 ${appTheme === "dark" ? "dark" : ""}`}>{children}</View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === null) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }

  return context;
};
