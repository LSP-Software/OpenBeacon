import { join } from "node:path";
import { setMockLocation } from "../app.ts";
import type { VerificationConfig } from "../config.ts";
import { adb } from "../device.ts";
import {
  captureLogcat,
  captureScreenshot,
  clearLogcat,
  fileAtLeast,
  gestureStep,
  MIN_SCREENSHOT_BYTES,
} from "../evidence.ts";
import type { JourneyRun, StepResult } from "../results.ts";
import { runStatus } from "../results.ts";
import { exec } from "../shell.ts";

const ANDROID_CLI_TIMEOUT_MS = 90_000;

const androidCliAvailable = (config: VerificationConfig): boolean => {
  const result = exec(config.androidCliBin, ["--no-metrics", "--version"], {
    timeoutMs: ANDROID_CLI_TIMEOUT_MS,
  });
  return result.code === 0;
};

export const runAndroidCliProbe = (
  config: VerificationConfig,
  serial: string,
  repetition: number,
  outDir: string,
): JourneyRun => {
  const startedAt = new Date().toISOString();
  clearLogcat(config, serial);
  setMockLocation(config, serial);

  const cliReady = androidCliAvailable(config);

  const layoutPath = join(outDir, "android-cli-layout.json");
  const layout = cliReady
    ? exec(
        config.androidCliBin,
        ["--no-metrics", "layout", "--pretty", "--device", serial, "--output", layoutPath],
        { timeoutMs: ANDROID_CLI_TIMEOUT_MS },
      )
    : null;
  const layoutOk = layout !== null && layout.code === 0 && fileAtLeast(layoutPath, 100);

  const mapShot = join(outDir, "android-cli-map.png");
  if (cliReady) {
    exec(
      config.androidCliBin,
      ["--no-metrics", "screen", "capture", "--device", serial, "--output", mapShot],
      { timeoutMs: ANDROID_CLI_TIMEOUT_MS },
    );
  }
  if (!fileAtLeast(mapShot, MIN_SCREENSHOT_BYTES)) {
    captureScreenshot(config, serial, outDir, "android-cli-map");
  }

  adb(config, serial, ["shell", "input", "swipe", "672", "1600", "300", "900", "400"]);
  const gestureShot = join(outDir, "android-cli-map-after-gesture.png");
  if (cliReady) {
    exec(
      config.androidCliBin,
      ["--no-metrics", "screen", "capture", "--device", serial, "--output", gestureShot],
      { timeoutMs: ANDROID_CLI_TIMEOUT_MS },
    );
  }
  if (!fileAtLeast(gestureShot, MIN_SCREENSHOT_BYTES)) {
    captureScreenshot(config, serial, outDir, "android-cli-map-after-gesture");
  }

  const logcat = captureLogcat(config, serial, outDir, "android-cli-logcat");

  const steps: StepResult[] = [
    {
      name: "Semantic UI inspection (android layout)",
      capability: "semantic-inspection",
      status: layoutOk ? "pass" : "fail",
      detail: cliReady
        ? `android layout ${layoutOk ? "produced" : "did not produce"} ${layoutPath}`
        : "android cli unavailable within timeout (first-run runtime download)",
      artifacts: layoutOk ? [layoutPath] : [],
    },
    {
      name: "MapLibre screenshot (android screen capture)",
      capability: "maplibre-screenshot",
      status: fileAtLeast(mapShot, MIN_SCREENSHOT_BYTES) ? "pass" : "fail",
      detail: `${mapShot} via ${cliReady ? "android cli" : "adb fallback"}`,
      artifacts: fileAtLeast(mapShot, MIN_SCREENSHOT_BYTES) ? [mapShot] : [],
    },
    gestureStep(
      "Map pan gesture (adb input; android cli has no gesture primitive)",
      "swipe issued via adb; android cli lacks a first-class gesture command",
      mapShot,
      gestureShot,
    ),
    {
      name: "Location-state observation (adb logcat; android cli has no logcat command)",
      capability: "location-observation",
      status: logcat.locationObserved ? "pass" : "fail",
      detail: logcat.locationObserved
        ? "FusedLocation delivery observed"
        : "no FusedLocation delivery captured",
      artifacts: [logcat.filtered],
    },
    {
      name: "Logcat capture (adb)",
      capability: "logcat",
      status: logcat.captured ? "pass" : "fail",
      detail: logcat.captured
        ? "android cli exposes no logcat command; captured via adb"
        : "logcat dump was empty",
      artifacts: [logcat.full, logcat.filtered],
    },
  ];

  return {
    runner: "android-cli",
    repetition,
    status: runStatus(steps),
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  };
};
