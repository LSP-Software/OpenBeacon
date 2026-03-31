import { beforeEach, describe, expect, mock, test } from "bun:test";

const storageValues = new Map<string, string>();

mock.module("./storage.ts", () => ({
  storage: {
    getString: (key: string) => storageValues.get(key),
    set: (key: string, value: string) => {
      storageValues.set(key, value);
    },
  },
}));

const importThemePreferencesModule = async () =>
  import(`./themePreferences.ts?test=${Math.random().toString(36).slice(2)}`) as Promise<
    typeof import("./themePreferences.ts")
  >;

describe("theme preferences", () => {
  beforeEach(() => {
    storageValues.clear();
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
});
