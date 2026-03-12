import { StatusBar } from "expo-status-bar";
import type React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { useColorScheme, View } from "react-native";

interface ThemeProviderProps {
  children: React.ReactNode;
}

type ThemeContextType = {
  theme: "light" | "dark";
};

export const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
});

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const systemColorScheme = useColorScheme();
  const [currentTheme, setCurrentTheme] = useState<"light" | "dark">(systemColorScheme ?? "light");

  useEffect(() => {
    if (systemColorScheme) {
      setCurrentTheme(systemColorScheme);
    }
  }, [systemColorScheme]);

  return (
    <ThemeContext.Provider value={{ theme: currentTheme }}>
      <StatusBar style={currentTheme === "dark" ? "light" : "dark"} />
      <View className={`flex-1 ${currentTheme === "dark" ? "dark" : ""}`}>
        {children}
      </View>
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
