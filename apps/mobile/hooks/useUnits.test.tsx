import { afterEach, expect, mock, test } from "bun:test";
import { act, useState } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const stored = new Map<string, string>();
mock.module("react-native-mmkv", () => ({
  useMMKVString: (key: string) => {
    const [, setVersion] = useState(0);
    return [
      stored.get(key),
      (value: string | undefined) => {
        if (value === undefined) stored.delete(key);
        else stored.set(key, value);
        setVersion((version) => version + 1);
      },
    ] as const;
  },
}));
mock.module("expo-localization", () => ({
  useLocales: () => [{ measurementSystem: "metric", regionCode: "FR" }],
}));
mock.module("../lib/storage.ts", () => ({ storage: {} }));

const { useUnits } = await import("./useUnits.ts");

let root: Root | null = null;

const renderUnits = async () => {
  const latest: { current: ReturnType<typeof useUnits> | null } = { current: null };
  const Screen = () => {
    latest.current = useUnits();
    return null;
  };
  root = createRoot();
  await act(async () => root?.render(<Screen />));
  return latest;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  stored.clear();
});

test("keeps the distance from a unit chosen before distance had its own setting", async () => {
  stored.set("units.speed", "mph");
  const units = await renderUnits();
  expect(units.current?.distance).toBe("mi");

  await act(async () => units.current?.setSpeedPreference("kmh"));
  expect(units.current?.speed).toBe("kmh");
  expect(units.current?.distance).toBe("mi");

  await act(async () => units.current?.setSpeedPreference("auto"));
  expect(units.current?.speed).toBe("kmh");
  expect(units.current?.distancePreference).toBe("mi");
});

test("lets speed and distance follow the region or be chosen separately", async () => {
  const units = await renderUnits();
  expect(units.current?.speed).toBe("kmh");
  expect(units.current?.distance).toBe("km");

  await act(async () => units.current?.setDistancePreference("mi"));
  await act(async () => units.current?.setSpeedPreference("mph"));
  await act(async () => units.current?.setDistancePreference("auto"));
  expect(units.current?.speed).toBe("mph");
  expect(units.current?.distance).toBe("km");
  expect(units.current?.distancePreference).toBe("auto");
});
