import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VerificationConfig } from "./config.ts";
import { adb } from "./device.ts";
import type { Capability, StepResult } from "./results.ts";
import { execBinary } from "./shell.ts";

export const MIN_SCREENSHOT_BYTES = 20_000;

export const fileAtLeast = (path: string | null, minBytes: number): path is string =>
  path !== null && existsSync(path) && statSync(path).size >= minBytes;

export const imagesDiffer = (before: string | null, after: string | null): boolean =>
  before !== null && after !== null && !readFileSync(before).equals(readFileSync(after));

export const screenshotStep = (
  name: string,
  capability: Capability,
  path: string | null,
): StepResult => {
  const present = fileAtLeast(path, MIN_SCREENSHOT_BYTES);
  return {
    name,
    capability,
    status: present ? "pass" : "fail",
    detail: present ? `${path} (${statSync(path).size} bytes)` : `screenshot not found: ${name}`,
    artifacts: present ? [path] : [],
  };
};

export const gestureStep = (
  name: string,
  detailPrefix: string,
  before: string | null,
  after: string | null,
): StepResult => {
  const present = fileAtLeast(after, MIN_SCREENSHOT_BYTES);
  const changed = present && imagesDiffer(before, after);
  return {
    name,
    capability: "map-gesture",
    status: changed ? "pass" : "fail",
    detail: changed
      ? `${detailPrefix}; map view changed after the pan`
      : present
        ? `${detailPrefix}; but the map view did not change after the pan (gesture unproven)`
        : `${detailPrefix}; gesture screenshot not captured`,
    artifacts: present ? [after] : [],
  };
};

const LOGCAT_FILTERS = [
  "FusedLocation",
  "ReactNativeJS",
  "ReactNative",
  "openbeacon",
  "OpenBeacon",
  "MapLibre",
  "ActivityTaskManager",
];

export const clearLogcat = (config: VerificationConfig, serial: string): void => {
  adb(config, serial, ["logcat", "-c"]);
};

export const captureScreenshot = (
  config: VerificationConfig,
  serial: string,
  outDir: string,
  name: string,
): string => {
  const path = join(outDir, `${name}.png`);
  const result = execBinary(config.adbPath, ["-s", serial, "exec-out", "screencap", "-p"], {
    timeoutMs: 30_000,
  });
  writeFileSync(path, result.stdout);
  return path;
};

export const captureLayout = (
  config: VerificationConfig,
  serial: string,
  outDir: string,
  name: string,
): string => {
  adb(config, serial, ["shell", "uiautomator", "dump", "/sdcard/ope98-layout.xml"]);
  const xml = adb(config, serial, ["shell", "cat", "/sdcard/ope98-layout.xml"]).stdout;
  const path = join(outDir, `${name}.xml`);
  writeFileSync(path, xml);
  return path;
};

export const captureLogcat = (
  config: VerificationConfig,
  serial: string,
  outDir: string,
  name: string,
): { full: string; filtered: string; captured: boolean; locationObserved: boolean } => {
  const dump = adb(config, serial, ["logcat", "-d", "-v", "time"]).stdout;
  const full = join(outDir, `${name}.log`);
  writeFileSync(full, dump);

  const filteredLines = dump
    .split("\n")
    .filter((line) => LOGCAT_FILTERS.some((tag) => line.includes(tag)));
  const filtered = join(outDir, `${name}.filtered.log`);
  writeFileSync(filtered, filteredLines.join("\n"));

  const captured = dump.trim().length > 0;
  const locationObserved = filteredLines.some((line) => line.includes("FusedLocation"));
  return { full, filtered, captured, locationObserved };
};

export const layoutContainsText = (
  config: VerificationConfig,
  serial: string,
  text: string,
): boolean => {
  adb(config, serial, ["shell", "uiautomator", "dump", "/sdcard/ope98-probe.xml"]);
  return adb(config, serial, ["shell", "cat", "/sdcard/ope98-probe.xml"]).stdout.includes(text);
};
