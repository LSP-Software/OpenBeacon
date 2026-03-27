import { StatusBar } from "expo-status-bar";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { type ColorSchemeName, useColorScheme, View } from "react-native";

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeContext = createContext<ColorSchemeName>("light");

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const systemColorScheme = useColorScheme();
  const [currentTheme, setCurrentTheme] = useState<ColorSchemeName>(systemColorScheme ?? "light");

  useEffect(() => {
    if (systemColorScheme) {
      setCurrentTheme(systemColorScheme);
    }
  }, [systemColorScheme]);

  return (
    <ThemeContext.Provider value={currentTheme}>
      <StatusBar style={currentTheme === "dark" ? "light" : "dark"} />
      <View className={`flex-1 ${currentTheme === "dark" ? "dark" : ""}`}>{children}</View>
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
