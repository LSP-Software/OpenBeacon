import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setMockLocation } from "../app.ts";
import type { VerificationConfig } from "../config.ts";
import {
  captureLayout,
  captureLogcat,
  clearLogcat,
  gestureStep,
  screenshotStep,
} from "../evidence.ts";
import type { JourneyRun, StepResult } from "../results.ts";
import { runStatus } from "../results.ts";
import { exec } from "../shell.ts";

const findArtifact = (root: string, basename: string): string | null => {
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name === basename) {
      return join(entry.parentPath, entry.name);
    }
  }
  return null;
};

export const runMaestroJourney = (
  config: VerificationConfig,
  serial: string,
  repetition: number,
  journeyPath: string,
  outDir: string,
): JourneyRun => {
  const startedAt = new Date().toISOString();
  clearLogcat(config, serial);
  setMockLocation(config, serial);

  const result = exec(
    config.maestroBin,
    ["test", "--device", serial, "--test-output-dir", outDir, journeyPath],
    {
      cwd: outDir,
      timeoutMs: 240_000,
      env: {
        EMAIL: config.account.email,
        PASSWORD: config.account.password,
        MAESTRO_DISABLE_ANALYTICS: "true",
      },
    },
  );
  writeFileSync(join(outDir, "maestro.log"), `${result.stdout}\n${result.stderr}`);

  const flowPassed = result.code === 0;
  const mapShot = findArtifact(outDir, "map.png");
  const gestureShot = findArtifact(outDir, "map-after-gesture.png");
  const layoutPath = captureLayout(config, serial, outDir, "map-layout");
  const logcat = captureLogcat(config, serial, outDir, "logcat");

  const steps: StepResult[] = [
    {
      name: "Authenticate and reach the map",
      capability: "navigation",
      status: flowPassed ? "pass" : "fail",
      detail: flowPassed
        ? "sign-in flow completed"
        : `maestro exit ${result.code} (see maestro.log)`,
      artifacts: [join(outDir, "maestro.log")],
    },
    {
      name: "Semantic UI inspection",
      capability: "semantic-inspection",
      status: flowPassed && existsSync(layoutPath) ? "pass" : "fail",
      detail: `assertVisible checks in flow + layout dump ${layoutPath}`,
      artifacts: [layoutPath],
    },
    screenshotStep("MapLibre screenshot", "maplibre-screenshot", mapShot),
    gestureStep("Map pan gesture", "maestro swipe on the map", mapShot, gestureShot),
    {
      name: "Location-state observation",
      capability: "location-observation",
      status: logcat.locationObserved ? "pass" : "fail",
      detail: logcat.locationObserved
        ? "FusedLocation delivery observed in logcat"
        : "no FusedLocation delivery captured",
      artifacts: [logcat.filtered],
    },
    {
      name: "Logcat capture",
      capability: "logcat",
      status: logcat.captured ? "pass" : "fail",
      detail: logcat.captured ? "full and filtered logcat captured" : "logcat dump was empty",
      artifacts: [logcat.full, logcat.filtered],
    },
  ];

  return {
    runner: "maestro",
    repetition,
    status: runStatus(steps),
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  };
};
