import { describe, expect, test } from "bun:test";
import type { JourneyRun, StepResult } from "./results.ts";
import { overallStatus, renderMarkdown, runStatus } from "./results.ts";

const step = (status: StepResult["status"]): StepResult => ({
  name: "step",
  capability: "logcat",
  status,
  detail: "",
  artifacts: [],
});

const run = (status: JourneyRun["status"], repetition: number): JourneyRun => ({
  runner: "maestro",
  repetition,
  status,
  startedAt: "2026-07-21T00:00:00.000Z",
  finishedAt: "2026-07-21T00:00:01.000Z",
  steps: [step(status)],
});

describe("runStatus", () => {
  test("fails when any step fails", () => {
    expect(runStatus([step("pass"), step("fail"), step("pass")])).toBe("fail");
  });

  test("passes when no step fails", () => {
    expect(runStatus([step("pass"), step("skipped")])).toBe("pass");
  });
});

describe("overallStatus", () => {
  test("passes only when every run passes", () => {
    expect(overallStatus([run("pass", 1), run("pass", 2), run("pass", 3)])).toBe("pass");
    expect(overallStatus([run("pass", 1), run("fail", 2)])).toBe("fail");
  });

  test("fails with no runs", () => {
    expect(overallStatus([])).toBe("fail");
  });
});

describe("renderMarkdown", () => {
  test("includes environment identity and per-run outcomes", () => {
    const markdown = renderMarkdown({
      ticket: "OPE-98",
      journeyName: "OpenBeacon map smoke (throwaway)",
      generatedAt: "2026-07-21T00:00:00.000Z",
      device: {
        serial: "emulator-5554",
        avdName: "Pixel_10_Pro_XL",
        androidApiLevel: "37",
        androidRelease: "17",
        model: "sdk_gphone16k_arm64",
      },
      app: { packageName: "net.openbeacon.app", apkPath: "/tmp/app-debug.apk" },
      tools: { adb: "1.0.41", emulator: "36.6", maestro: "2.0", androidCli: "1.0" },
      runs: [run("pass", 1)],
      overallStatus: "pass",
    });

    expect(markdown).toContain("Pixel_10_Pro_XL");
    expect(markdown).toContain("Android API 37");
    expect(markdown).toContain("maestro: 2.0");
    expect(markdown).toContain("repetition 1: pass");
  });
});
