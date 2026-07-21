import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VerificationConfig } from "./config.ts";
import { adb } from "./device.ts";
import { sleep, waitFor } from "./shell.ts";

export const locateApk = (config: VerificationConfig): string => {
  const override = process.env["OPENBEACON_VERIFY_APK"];
  if (override !== undefined && override.length > 0) {
    if (!existsSync(override)) {
      throw new Error(`OPENBEACON_VERIFY_APK points to a missing file: ${override}`);
    }
    return override;
  }

  const standard = join(
    config.repoRoot,
    "apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk",
  );
  if (existsSync(standard)) {
    return standard;
  }
  throw new Error(
    `No development APK found at ${standard}. Build it first with "bun run --cwd apps/mobile android" or set OPENBEACON_VERIFY_APK.`,
  );
};

const waitForPackageService = async (config: VerificationConfig, serial: string): Promise<void> => {
  await waitFor(
    () => adb(config, serial, ["shell", "pm", "path", "android"]).stdout.includes("package:"),
    {
      timeoutMs: 60_000,
      intervalMs: 2_000,
    },
  );
};

export const installApp = async (
  config: VerificationConfig,
  serial: string,
  apkPath: string,
): Promise<void> => {
  await waitForPackageService(config, serial);
  adb(config, serial, ["uninstall", config.packageName]);
  const result = adb(config, serial, ["install", "-r", "-g", apkPath]);
  if (!/\bSuccess\b/.test(result.stdout)) {
    throw new Error(`APK install failed: ${result.stdout} ${result.stderr}`.trim());
  }
};

export const grantRuntimePermissions = (config: VerificationConfig, serial: string): void => {
  for (const permission of [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.POST_NOTIFICATIONS",
  ]) {
    adb(config, serial, ["shell", "pm", "grant", config.packageName, permission]);
  }
};

export const setMockLocation = (config: VerificationConfig, serial: string): void => {
  adb(config, serial, [
    "emu",
    "geo",
    "fix",
    String(config.location.longitude),
    String(config.location.latitude),
  ]);
};

export const isMetroReachable = async (config: VerificationConfig): Promise<boolean> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`http://localhost:${config.metroPort}/status`, {
      signal: controller.signal,
    });
    const body = await response.text();
    return body.includes("packager-status:running");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};

export const launchDevBuild = async (config: VerificationConfig, serial: string): Promise<void> => {
  adb(config, serial, ["reverse", `tcp:${config.metroPort}`, `tcp:${config.metroPort}`]);
  adb(config, serial, ["reverse", `tcp:${config.backendPort}`, `tcp:${config.backendPort}`]);
  adb(config, serial, ["shell", "am", "force-stop", config.packageName]);
  await sleep(1_500);

  const bundleUrl = `http://localhost:${config.metroPort}`;
  adb(config, serial, [
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `${config.appScheme}://expo-development-client/?url=${encodeURIComponent(bundleUrl)}`,
  ]);

  const rendered = await waitFor(
    () =>
      adb(config, serial, ["shell", "dumpsys", "activity", "activities"]).stdout.includes(
        `${config.packageName}/.MainActivity`,
      ),
    { timeoutMs: 180_000, intervalMs: 3_000 },
  );
  if (!rendered) {
    throw new Error("Dev build did not reach MainActivity (is Metro bundling?)");
  }
};

const dumpUiText = (config: VerificationConfig, serial: string): string => {
  adb(config, serial, ["shell", "uiautomator", "dump", "/sdcard/ope98-settle.xml"]);
  return adb(config, serial, ["shell", "cat", "/sdcard/ope98-settle.xml"]).stdout;
};

const DEV_MENU_INTRO_MARKER = "This is the developer menu";
const DEV_OVERLAY_MARKERS = [
  "developer menu",
  "Toggle element inspector",
  "Open DevTools",
  "Runtime version:",
];
const APP_CONTENT_MARKERS = ["Sign In", "Create Account", "Welcome"];

const nodeCenter = (xml: string, text: string): { x: number; y: number } | null => {
  const match = new RegExp(
    `text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
  ).exec(xml);
  if (match === null) {
    return null;
  }
  const [x1, y1, x2, y2] = [match[1], match[2], match[3], match[4]].map(Number) as [
    number,
    number,
    number,
    number,
  ];
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
};

const dismissDevOverlay = (config: VerificationConfig, serial: string, xml: string): void => {
  if (xml.includes(DEV_MENU_INTRO_MARKER)) {
    const target = nodeCenter(xml, "Continue");
    if (target !== null) {
      adb(config, serial, ["shell", "input", "tap", String(target.x), String(target.y)]);
      return;
    }
  }
  adb(config, serial, ["shell", "input", "keyevent", "KEYCODE_BACK"]);
};

export const settleToApp = async (config: VerificationConfig, serial: string): Promise<boolean> =>
  waitFor(
    () => {
      const text = dumpUiText(config, serial);
      const overlayOpen = DEV_OVERLAY_MARKERS.some((marker) => text.includes(marker));
      const contentReady = APP_CONTENT_MARKERS.some((marker) => text.includes(marker));
      if (overlayOpen) {
        dismissDevOverlay(config, serial, text);
        return false;
      }
      return contentReady;
    },
    { timeoutMs: 120_000, intervalMs: 2_500 },
  );

export const uninstallApp = (config: VerificationConfig, serial: string): void => {
  adb(config, serial, ["uninstall", config.packageName]);
};
