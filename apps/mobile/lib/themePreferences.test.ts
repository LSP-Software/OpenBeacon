import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();
const mockedThemeState = {
  appTheme: "light" as "dark" | "light",
  mapTheme: "light" as "dark" | "light",
};

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

mock.module("../providers/ThemeProvider.tsx", () => ({
  useTheme: () => mockedThemeState,
}));

const importThemePreferencesModule = async () =>
  import(`./themePreferences.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./themePreferences.ts")
  >;

const importThemeModule = async () =>
  import(`./theme.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./theme.ts")
  >;

describe("theme preferences", () => {
  beforeEach(() => {
    storageValues.clear();
    mockedThemeState.appTheme = "light";
    mockedThemeState.mapTheme = "light";
  });

  test("defaults both theme preferences to system when nothing is stored", async () => {
    const { getStoredAppThemePreference, getStoredMapThemePreference } =
      await importThemePreferencesModule();

    expect(getStoredAppThemePreference()).toBe("system");
    expect(getStoredMapThemePreference()).toBe("system");
  });

  test("falls back to system when stored values are invalid", async () => {
    storageValues.set("theme.preference.app", "midnight");
    storageValues.set("theme.preference.map", "sunrise");

    const { getStoredAppThemePreference, getStoredMapThemePreference } =
      await importThemePreferencesModule();

    expect(getStoredAppThemePreference()).toBe("system");
    expect(getStoredMapThemePreference()).toBe("system");
  });

  test("stores app and map theme preferences independently", async () => {
    const {
      getStoredAppThemePreference,
      getStoredMapThemePreference,
      setStoredAppThemePreference,
      setStoredMapThemePreference,
    } = await importThemePreferencesModule();

    setStoredAppThemePreference("dark");
    setStoredMapThemePreference("light");

    expect(getStoredAppThemePreference()).toBe("dark");
    expect(getStoredMapThemePreference()).toBe("light");
  });

  test("resolves system preferences using the current device color scheme", async () => {
    const { resolveThemePreference } = await importThemePreferencesModule();

    expect(resolveThemePreference("system", "dark")).toBe("dark");
    expect(resolveThemePreference("system", "light")).toBe("light");
    expect(resolveThemePreference("system", undefined)).toBe("light");
    expect(resolveThemePreference("dark", "light")).toBe("dark");
    expect(resolveThemePreference("light", "dark")).toBe("light");
  });

  test("uses app theme preferences for colors while map consumers read the map preference", async () => {
    const {
      getStoredAppThemePreference,
      getStoredMapThemePreference,
      resolveThemePreference,
      setStoredAppThemePreference,
      setStoredMapThemePreference,
    } = await importThemePreferencesModule();
    const { getColors, useColors } = await importThemeModule();

    setStoredAppThemePreference("system");
    setStoredMapThemePreference("dark");

    mockedThemeState.appTheme = resolveThemePreference(getStoredAppThemePreference(), "light");
    mockedThemeState.mapTheme = resolveThemePreference(getStoredMapThemePreference(), "light");

    expect(getStoredAppThemePreference()).toBe("system");
    expect(getStoredMapThemePreference()).toBe("dark");
    expect(useColors()).toEqual(getColors("light"));
    expect(mockedThemeState.mapTheme).toBe("dark");
  });
});
