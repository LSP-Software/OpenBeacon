import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceMetadata } from "./device.ts";

export type Capability =
  | "semantic-inspection"
  | "maplibre-screenshot"
  | "map-gesture"
  | "location-observation"
  | "logcat"
  | "navigation";

export type StepStatus = "pass" | "fail" | "skipped";

export type StepResult = {
  name: string;
  capability: Capability;
  status: StepStatus;
  detail: string;
  artifacts: string[];
};

export type JourneyRun = {
  runner: string;
  repetition: number;
  status: StepStatus;
  startedAt: string;
  finishedAt: string;
  steps: StepResult[];
};

export type ToolVersions = {
  adb: string;
  emulator: string;
  maestro: string;
  androidCli: string;
};

export type RunReport = {
  ticket: "OPE-98";
  journeyName: string;
  generatedAt: string;
  device: DeviceMetadata;
  app: { packageName: string; apkPath: string };
  tools: ToolVersions;
  runs: JourneyRun[];
  overallStatus: StepStatus;
};

export const runStatus = (steps: readonly StepResult[]): StepStatus =>
  steps.some((step) => step.status === "fail") ? "fail" : "pass";

export const overallStatus = (runs: readonly JourneyRun[]): StepStatus =>
  runs.length > 0 && runs.every((run) => run.status === "pass") ? "pass" : "fail";

const renderRun = (run: JourneyRun): string => {
  const lines = run.steps.map(
    (step) => `  - [${step.status}] (${step.capability}) ${step.name}: ${step.detail}`,
  );
  return [`### ${run.runner} — repetition ${run.repetition}: ${run.status}`, ...lines].join("\n");
};

export const renderMarkdown = (report: RunReport): string =>
  [
    `# OPE-98 verification report: ${report.journeyName}`,
    "",
    `Generated: ${report.generatedAt}`,
    `Overall: **${report.overallStatus}**`,
    "",
    "## Environment",
    `- AVD: ${report.device.avdName} (${report.device.serial})`,
    `- Android API ${report.device.androidApiLevel} (release ${report.device.androidRelease})`,
    `- Model: ${report.device.model}`,
    `- App: ${report.app.packageName}`,
    `- APK: ${report.app.apkPath}`,
    "",
    "## Tool versions",
    `- adb: ${report.tools.adb}`,
    `- emulator: ${report.tools.emulator}`,
    `- maestro: ${report.tools.maestro}`,
    `- android cli: ${report.tools.androidCli}`,
    "",
    "## Runs",
    ...report.runs.map(renderRun),
    "",
    "---",
    "This is a pre-review quality filter only. Human product and code review is still required.",
    "",
  ].join("\n");

export const writeReport = (
  report: RunReport,
  outDir: string,
): { json: string; markdown: string } => {
  mkdirSync(outDir, { recursive: true });
  const json = join(outDir, "report.json");
  const markdown = join(outDir, "report.md");
  writeFileSync(json, JSON.stringify(report, null, 2));
  writeFileSync(markdown, renderMarkdown(report));
  return { json, markdown };
};
