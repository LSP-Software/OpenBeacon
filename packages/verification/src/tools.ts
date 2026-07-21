import type { VerificationConfig } from "./config.ts";
import type { ToolVersions } from "./results.ts";
import { exec } from "./shell.ts";

const firstLine = (value: string): string => value.split("\n")[0]?.trim() ?? "";

const versionOf = (binary: string, args: readonly string[]): string => {
  const result = exec(binary, args, { timeoutMs: 20_000 });
  if (result.code !== 0 && result.stdout.trim().length === 0) {
    return "unavailable";
  }
  return firstLine(result.stdout.length > 0 ? result.stdout : result.stderr) || "unknown";
};

export const resolveToolVersions = (config: VerificationConfig): ToolVersions => ({
  adb: versionOf(config.adbPath, ["--version"]),
  emulator: versionOf(config.emulatorPath, ["-version"]),
  maestro: versionOf(config.maestroBin, ["--version"]),
  androidCli: versionOf(config.androidCliBin, ["--no-metrics", "--version"]),
});
