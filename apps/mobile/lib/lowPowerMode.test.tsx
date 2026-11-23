import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "test-renderer";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let saved = true;
let reads = 0;
const alerts: { title: string; message: string | undefined }[] = [];
const tracking: { isLowPowerMode?: () => boolean; setLowPowerMode: (enabled: boolean) => void } = {
  setLowPowerMode: () => {},
};
mock.module("../modules/openbeacon-tracking/index.ts", () => ({ default: tracking }));
mock.module("./alert.ts", () => ({
  Alert: {
    alert: (title: string, message?: string) => {
      alerts.push({ title, message });
    },
  },
}));

let imports = 0;
let root: Root | null = null;

const loadLowPowerMode = async (): Promise<typeof import("./lowPowerMode.ts")> => {
  imports += 1;
  return import(`./lowPowerMode.ts?fresh=${imports}`);
};

const renderShown = async (useLowPowerMode: () => boolean) => {
  const shown: boolean[] = [];
  const Screen = () => {
    shown.push(useLowPowerMode());
    return null;
  };
  root = createRoot();
  await act(async () => root?.render(<Screen />));
  return shown;
};

beforeEach(() => {
  saved = true;
  reads = 0;
  alerts.length = 0;
  tracking.isLowPowerMode = () => {
    reads += 1;
    return saved;
  };
  tracking.setLowPowerMode = (enabled: boolean) => {
    saved = enabled;
  };
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
});

test("low power mode starts as this phone saved it, and a change is saved and shown at once", async () => {
  const { setLowPowerMode, useLowPowerMode } = await loadLowPowerMode();
  const shown = await renderShown(useLowPowerMode);
  expect(shown).toEqual([true]);

  await act(async () => setLowPowerMode(false));

  expect(saved).toBe(false);
  expect(shown).toEqual([true, false]);
  expect(alerts).toEqual([]);
});

test("the saved setting is only read from the phone when something first shows it", async () => {
  const { useLowPowerMode } = await loadLowPowerMode();
  expect(reads).toBe(0);

  await renderShown(useLowPowerMode);
  await renderShown(useLowPowerMode);

  expect(reads).toBe(1);
});

test("an app build without the native setting shows low power mode as off", async () => {
  delete tracking.isLowPowerMode;
  const { useLowPowerMode } = await loadLowPowerMode();

  expect(await renderShown(useLowPowerMode)).toEqual([false]);
});

test("a native read that throws shows low power mode as off", async () => {
  tracking.isLowPowerMode = () => {
    throw new Error("Native module missing");
  };
  const { useLowPowerMode } = await loadLowPowerMode();

  expect(await renderShown(useLowPowerMode)).toEqual([false]);
});

test("a change the phone couldn't save keeps the old value and says so", async () => {
  tracking.setLowPowerMode = () => {
    throw new Error("commit failed");
  };
  const { setLowPowerMode, useLowPowerMode } = await loadLowPowerMode();
  const shown = await renderShown(useLowPowerMode);

  await act(async () => setLowPowerMode(false));

  expect(saved).toBe(true);
  expect(shown).toEqual([true]);
  expect(alerts).toEqual([
    { title: "Couldn’t change Save battery while moving", message: "Try again." },
  ]);
});
