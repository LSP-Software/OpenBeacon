import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import type { VerificationConfig } from "./config.ts";
import { exec, sleep, waitFor } from "./shell.ts";

export type DeviceMetadata = {
  serial: string;
  avdName: string;
  androidApiLevel: string;
  androidRelease: string;
  model: string;
};

export const adb = (config: VerificationConfig, serial: string | null, args: readonly string[]) =>
  exec(config.adbPath, serial === null ? args : ["-s", serial, ...args], { timeoutMs: 120_000 });

const listEmulatorSerials = (config: VerificationConfig): string[] => {
  const result = exec(config.adbPath, ["devices"], { timeoutMs: 20_000 });
  return result.stdout
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.endsWith("device") && line.startsWith("emulator-"))
    .map((line) => line.split(/\s+/)[0] ?? "")
    .filter((serial) => serial.length > 0);
};

const avdNameForSerial = (config: VerificationConfig, serial: string): string | null => {
  const result = adb(config, serial, ["emu", "avd", "name"]);
  const name = result.stdout.split("\n")[0]?.trim();
  return name !== undefined && name.length > 0 && name !== "OK" ? name : null;
};

const findRunningSerial = (config: VerificationConfig): string | null => {
  for (const serial of listEmulatorSerials(config)) {
    if (avdNameForSerial(config, serial) === config.avdName) {
      return serial;
    }
  }
  return null;
};

const bootEmulator = (config: VerificationConfig, logPath: string): void => {
  const logFd = openSync(logPath, "a");
  const child = spawn(
    config.emulatorPath,
    [
      "-avd",
      config.avdName,
      "-no-window",
      "-no-boot-anim",
      "-no-audio",
      "-no-snapshot",
      "-no-metrics",
      "-gpu",
      "swiftshader_indirect",
    ],
    { detached: true, stdio: ["ignore", logFd, logFd] },
  );
  child.unref();
};

const waitForBootCompleted = async (
  config: VerificationConfig,
  serial: string,
): Promise<boolean> => {
  adb(config, serial, ["wait-for-device"]);
  return waitFor(
    () => adb(config, serial, ["shell", "getprop", "sys.boot_completed"]).stdout.trim() === "1",
    { timeoutMs: 300_000, intervalMs: 3_000 },
  );
};

export const getDeviceMetadata = (config: VerificationConfig, serial: string): DeviceMetadata => {
  const prop = (name: string) => adb(config, serial, ["shell", "getprop", name]).stdout.trim();
  return {
    serial,
    avdName: avdNameForSerial(config, serial) ?? config.avdName,
    androidApiLevel: prop("ro.build.version.sdk"),
    androidRelease: prop("ro.build.version.release"),
    model: prop("ro.product.model"),
  };
};

export const selectDevice = async (
  config: VerificationConfig,
  logPath: string,
): Promise<DeviceMetadata> => {
  const running = findRunningSerial(config);
  if (running !== null) {
    if (!(await waitForBootCompleted(config, running))) {
      throw new Error(`Emulator ${running} did not finish booting`);
    }
    return getDeviceMetadata(config, running);
  }

  const before = new Set(listEmulatorSerials(config));
  bootEmulator(config, logPath);

  const appeared = await waitFor(
    () => listEmulatorSerials(config).some((serial) => !before.has(serial)),
    { timeoutMs: 120_000, intervalMs: 2_000 },
  );
  if (!appeared) {
    throw new Error(`Emulator for AVD ${config.avdName} did not register with adb`);
  }

  await sleep(1_000);
  const serial = listEmulatorSerials(config).find((candidate) => !before.has(candidate));
  if (serial === undefined) {
    throw new Error(`Could not resolve serial for AVD ${config.avdName}`);
  }
  if (!(await waitForBootCompleted(config, serial))) {
    throw new Error(`Emulator ${serial} did not finish booting`);
  }
  return getDeviceMetadata(config, serial);
};
